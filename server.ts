import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import {
  listItems, getItem, saveItem, updateItem, deleteItem,
  writeItemFile, readItemFile,
  listFolders, saveFolder, deleteFolder, replaceFolders,
} from './libraryStore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Google GenAI
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/**
 * Convert 16-bit PCM Buffer into standard RIFF WAV Buffer
 */
function pcmToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  // RIFF identifier
  header.write('RIFF', 0);
  // File size minus 8 bytes
  header.writeUInt32LE(36 + dataSize, 4);
  // RIFF type & format header
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  // Format chunk size (16 for PCM)
  header.writeUInt32LE(16, 16);
  // Audio format (1 = PCM)
  header.writeUInt16LE(1, 20);
  // Number of channels
  header.writeUInt16LE(numChannels, 22);
  // Sample rate
  header.writeUInt32LE(sampleRate, 24);
  // Byte rate
  header.writeUInt32LE(byteRate, 28);
  // Block align
  header.writeUInt16LE(blockAlign, 32);
  // Bits per sample
  header.writeUInt16LE(bitsPerSample, 34);
  // Data chunk header
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * WSOLA 时长伸缩（16bit mono PCM）：speed > 1 加快、< 1 放慢，音高不变。
 * 经典算法——Hann 窗 50% 重叠相加，分析步进随 speed 缩放，
 * 每帧在 ±delta 内搜索与上一帧“自然延续”相关性最佳的对齐点，消除相位断裂。
 */
function wsolaTimeStretch(pcm: Buffer, speed: number): Buffer {
  if (!Number.isFinite(speed) || Math.abs(speed - 1.0) < 0.03 || pcm.length < 8192) return pcm;
  const clamped = Math.max(0.5, Math.min(2.0, speed));
  const src = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < src.length; i++) src[i] = pcm.readInt16LE(i * 2) / 32768;

  const N = 1024;                          // 帧长 ~43ms @24kHz
  const Hs = N >> 1;                       // 合成步进
  const Ha = Math.max(1, Math.round(Hs * clamped)); // 分析步进
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  const outLen = Math.ceil((src.length * Hs) / Ha) + N + 1;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);

  const addFrame = (ana: number, syn: number) => {
    for (let i = 0; i < N; i++) {
      out[syn + i] += src[ana + i] * win[i];
      norm[syn + i] += win[i];
    }
  };

  let ana = 0;
  let syn = 0;
  addFrame(ana, syn);
  // 上一帧的自然延续（后半段），下一帧的头部要和它对齐
  let natural = src.subarray(ana + Hs, ana + N);

  // 对齐搜索：窗口以名义位置为中心，半径自适应且严格小于 |Hs−Ha|。
  // 完美对齐点（off = Hs−Ha，候选==参照）同时是塌缩点——选中它帧步进退化为
  // Hs，变速失效；半径压在它之内既排除塌缩，又保证跨淡交界错位不超过
  // |Hs−Ha|−delta，避免相位抵消打穿语音。|off| 轻惩罚让步进收敛在 Ha 附近。
  const ideal = Hs - Ha;
  const delta = Math.min(120, Math.max(8, Math.floor(Math.abs(ideal) * 0.75)));
  const PENALTY = 0.0015;

  while (true) {
    const nextNominal = ana + Ha;
    if (nextNominal + N + delta >= src.length) break;
    let bestOff = 0;
    let bestScore = -Infinity;
    for (let off = -delta; off <= delta; off += 2) {
      const p = nextNominal + off;
      if (p < 0 || p + Hs >= src.length) continue;
      let dot = 0;
      let energy = 1e-9;
      for (let i = 0; i < Hs; i += 4) {
        const v = src[p + i];
        dot += natural[i] * v;
        energy += v * v;
      }
      const score = (dot / Math.sqrt(energy)) * (1 - PENALTY * Math.abs(off));
      if (score > bestScore) {
        bestScore = score;
        bestOff = off;
      }
    }
    ana = nextNominal + bestOff;
    syn += Hs;
    if (syn + N >= outLen) break;
    addFrame(ana, syn);
    natural = src.subarray(ana + Hs, ana + N);
  }

  const pcmOut = Buffer.alloc(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const v = out[i] / Math.max(norm[i], 1e-6);
    pcmOut.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  return pcmOut;
}

/** 对整段 WAV 施加语速（剥离 44 字节头 → WSOLA → 重新封包） */
function applySpeedToWav(wav: Buffer, speed?: number, sampleRate = 24000): Buffer {
  const s = Number(speed) || 1;
  if (Math.abs(s - 1) < 0.03) return wav;
  if (wav.toString('ascii', 0, 4) !== 'RIFF') return wav;
  const stretched = wsolaTimeStretch(wav.subarray(44), s);
  return pcmToWavBuffer(stretched, sampleRate, 1, 16);
}

// -------------------------------------------------------------
// TTS Engine Adapter Layer (可插拔语音引擎)
// 每个本地/云端引擎实现同一个接口；按请求里的 ttsModel 路由。
// 新增引擎：实现 TTSEngineAdapter → push 进 ttsAdapters → 前端模型列表加一项。
// -------------------------------------------------------------

interface TTSSynthesizeRequest {
  text: string;
  voiceName: string;
  ttsModel?: string;
  emotion?: string;
  systemInstruction?: string;
  speed?: number;
  temperature?: number;
  multiSpeaker?: boolean;
  speakers?: { speaker: string; voiceName: string }[];
}

interface TTSSynthesizeResult {
  wavBase64: string;
  sampleRate: number;
  duration: number; // seconds
  voiceName: string;
}

interface TTSEngineAdapter {
  id: string;
  label: string;
  requiresApiKey: boolean;
  isAvailable(): Promise<boolean>;
  synthesize(req: TTSSynthesizeRequest): Promise<TTSSynthesizeResult>;
}

/* ---------- Adapter: Google Gemini (云端) ---------- */

const geminiAdapter: TTSEngineAdapter = {
  id: 'gemini',
  label: 'Google Gemini Audio',
  requiresApiKey: true,
  isAvailable: async () => Boolean(apiKey),
  async synthesize(req) {
    let speechPrompt = req.text;
    if (req.emotion) {
      speechPrompt = `Speak with an emotion and tone of [${req.emotion}]: ${req.text}`;
    }

    const targetModel = req.ttsModel || 'gemini-2.5-flash-preview-tts';
    const tempValue = Math.max(0.1, Math.min(1.5, Number(req.temperature) || 0.7));

    let response;
    if (req.multiSpeaker && Array.isArray(req.speakers) && req.speakers.length >= 2) {
      response = await ai.models.generateContent({
        model: targetModel,
        contents: [{ parts: [{ text: speechPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          temperature: tempValue,
          ...(req.systemInstruction ? { systemInstruction: req.systemInstruction } : {}),
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                {
                  speaker: req.speakers[0].speaker || 'Speaker1',
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: req.speakers[0].voiceName || 'Kore' },
                  },
                },
                {
                  speaker: req.speakers[1].speaker || 'Speaker2',
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: req.speakers[1].voiceName || 'Puck' },
                  },
                },
              ],
            },
          },
        },
      });
    } else {
      response = await ai.models.generateContent({
        model: targetModel,
        contents: [{ parts: [{ text: speechPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          temperature: tempValue,
          ...(req.systemInstruction ? { systemInstruction: req.systemInstruction } : {}),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: req.voiceName || 'Kore' },
            },
          },
        },
      });
    }

    const candidate = response.candidates?.[0];
    const audioPart = candidate?.content?.parts?.find(p => p.inlineData?.data);
    if (!audioPart || !audioPart.inlineData?.data) {
      throw new Error('No audio returned by speech synthesis model.');
    }

    const rawData = audioPart.inlineData.data;
    const mimeType = audioPart.inlineData.mimeType || 'audio/pcm';

    let wavBase64 = rawData;
    if (mimeType.includes('pcm') || !mimeType.includes('wav')) {
      const pcmBuffer = Buffer.from(rawData, 'base64');
      wavBase64 = pcmToWavBuffer(pcmBuffer, 24000, 1, 16).toString('base64');
    }

    const pcmBytes = Buffer.from(rawData, 'base64');
    const estimatedDuration = Math.round((pcmBytes.length / (24000 * 2)) * 10) / 10;

    return {
      wavBase64,
      sampleRate: 24000,
      duration: estimatedDuration,
      voiceName: req.voiceName,
    };
  },
};

/* ---------- Adapter: 本地 Qwen3-TTS (经 Gradio HTTP 服务) ---------- */

const QWEN_GRADIO_BASE = process.env.QWEN_TTS_URL || 'http://127.0.0.1:7860';
const QWEN_SAMPLE_RATE = 24000;

// UI 音色 persona → Qwen speaker（音色来自模型 get_supported_speakers）
const QWEN_VOICE_MAP: Record<string, string> = {
  Kore: 'Eric',       // 权威男中音
  Puck: 'Aiden',      // 朝气男高音
  Fenrir: 'Uncle Fu', // 电影级重低音
  Charon: 'Ryan',     // 播音级标准音
  Zephyr: 'Vivian',   // 知性疗愈女声
};

const QWEN_EMOTION_INSTRUCT: Record<string, string> = {
  沉稳专业: '用沉稳、专业、清晰的语气朗读，语速适中。',
  热情激昂: '用热情、激昂、充满能量的语气朗读，语调起伏明显。',
  悬疑低语: '用神秘、低声耳语的语气朗读，营造悬疑氛围，语速偏慢。',
  温暖亲切: '用温暖、亲切、柔和的语气朗读，像讲睡前故事一样。',
  史诗震撼: '用史诗感、宏大震撼的电影预告片旁白语气朗读。',
};

function toQwenInstruct(emotion?: string, systemInstruction?: string): string | null {
  const parts: string[] = [];
  if (emotion) parts.push(QWEN_EMOTION_INSTRUCT[emotion] || `用${emotion}的语气朗读。`);
  if (systemInstruction) parts.push(systemInstruction);
  return parts.length ? parts.join(' ') : null;
}

function wavDuration(wav: Buffer): number {
  if (wav.length <= 44) return 0;
  const sampleRate = wav.readUInt32LE(24) || QWEN_SAMPLE_RATE;
  return Math.round(((wav.length - 44) / (sampleRate * 2)) * 10) / 10;
}

/** 调 Gradio /run_instruct 合成一段音频，返回完整 WAV Buffer */
async function qwenGradioSynthesizeOnce(text: string, speaker: string, instruct: string | null): Promise<Buffer> {
  const submitRes = await fetch(`${QWEN_GRADIO_BASE}/gradio_api/call/run_instruct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [text, 'Auto', speaker, instruct] }),
  });
  if (!submitRes.ok) {
    throw new Error(`本地 Qwen3-TTS 服务提交失败 (HTTP ${submitRes.status})，请确认已双击「启动网页版.command」。`);
  }
  const { event_id: eventId } = (await submitRes.json()) as { event_id?: string };
  if (!eventId) throw new Error('本地 Qwen3-TTS 服务未返回 event_id。');

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 300_000);
  try {
    const streamRes = await fetch(`${QWEN_GRADIO_BASE}/gradio_api/call/run_instruct/${eventId}`, {
      signal: abort.signal,
    });
    if (!streamRes.ok || !streamRes.body) {
      throw new Error(`本地 Qwen3-TTS 结果流获取失败 (HTTP ${streamRes.status})。`);
    }

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const errorMatch = buffer.match(/event:\s*error\s*\ndata:\s*(.*)\s*\n/);
      if (errorMatch) throw new Error(`本地 Qwen3-TTS 合成失败: ${errorMatch[1].slice(0, 200)}`);

      const completeMatch = buffer.match(/event:\s*complete\s*\ndata:\s*(\[.*\])\s*\n/);
      if (completeMatch) {
        const payload = JSON.parse(completeMatch[1]);
        const fileUrl: string | undefined = payload?.[0]?.url;
        if (!fileUrl) throw new Error('本地 Qwen3-TTS 未返回音频文件。');
        const audioRes = await fetch(fileUrl.startsWith('http') ? fileUrl : `${QWEN_GRADIO_BASE}${fileUrl}`);
        if (!audioRes.ok) throw new Error(`本地 Qwen3-TTS 音频下载失败 (HTTP ${audioRes.status})。`);
        return Buffer.from(await audioRes.arrayBuffer());
      }
    }
    throw new Error('本地 Qwen3-TTS 结果流在完成前中断。');
  } finally {
    clearTimeout(timer);
  }
}

/** 拼接多段同格式 WAV（24kHz/16bit/单声道，44 字节头），段间可插入静音 */
function concatWavBuffers(wavs: Buffer[], gapSeconds = 0): Buffer {
  const gapBytes = Math.round(gapSeconds * QWEN_SAMPLE_RATE) * 2;
  const chunks: Buffer[] = [];
  wavs.forEach((w, i) => {
    if (w.toString('ascii', 0, 4) !== 'RIFF') throw new Error('音频格式异常：非 RIFF/WAV 文件。');
    if (i > 0 && gapBytes > 0) chunks.push(Buffer.alloc(gapBytes));
    chunks.push(w.subarray(44));
  });
  return pcmToWavBuffer(Buffer.concat(chunks), QWEN_SAMPLE_RATE, 1, 16);
}

const qwenLocalAdapter: TTSEngineAdapter = {
  id: 'qwen3-tts-local',
  label: 'Qwen3-TTS 1.7B (本地)',
  requiresApiKey: false,
  isAvailable: async () => {
    try {
      const res = await fetch(`${QWEN_GRADIO_BASE}/gradio_api/info`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  },
  async synthesize(req) {
    const instruct = toQwenInstruct(req.emotion, req.systemInstruction);
    const primaryVoice = QWEN_VOICE_MAP[req.voiceName] || req.voiceName || 'Vivian';

    // 双人对话：按「角色: 台词」逐行合成再拼接（Qwen 不支持原生多人对谈）
    if (req.multiSpeaker && req.speakers && req.speakers.length >= 2) {
      const voiceFor = (name: string): string => {
        const hit = req.speakers!.find(s => s.speaker === name);
        return QWEN_VOICE_MAP[hit?.voiceName || ''] || primaryVoice;
      };
      const lines = req.text.split(/\n+/).map(l => l.trim()).filter(Boolean);
      const parsed = lines
        .map(line => {
          const m = line.match(/^\s*([^：:]{1,20})[：:]\s*(.+)$/);
          return m ? { name: m[1].trim(), text: m[2].trim() } : null;
        })
        .filter((x): x is { name: string; text: string } => x !== null);
      const segments = parsed.length ? parsed : [{ name: req.speakers[0].speaker || 'Speaker1', text: req.text }];

      const wavs: Buffer[] = [];
      for (const seg of segments) {
        const segWav = await qwenGradioSynthesizeOnce(seg.text, voiceFor(seg.name), instruct);
        wavs.push(applySpeedToWav(segWav, req.speed));
      }
      const wav = concatWavBuffers(wavs, 0.3); // 段间 0.3s 停顿，模拟对话自然节奏
      return {
        wavBase64: wav.toString('base64'),
        sampleRate: QWEN_SAMPLE_RATE,
        duration: wavDuration(wav),
        voiceName: primaryVoice,
      };
    }

    const raw = await qwenGradioSynthesizeOnce(req.text, primaryVoice, instruct);
    const wav = applySpeedToWav(raw, req.speed);
    return {
      wavBase64: wav.toString('base64'),
      sampleRate: QWEN_SAMPLE_RATE,
      duration: wavDuration(wav),
      voiceName: primaryVoice,
    };
  },
};

const ttsAdapters: TTSEngineAdapter[] = [geminiAdapter, qwenLocalAdapter];

function resolveTtsAdapter(ttsModel?: string): TTSEngineAdapter {
  if (ttsModel === qwenLocalAdapter.id) return qwenLocalAdapter;
  return geminiAdapter; // 其余模型 ID 均走 Gemini 家族
}

// -------------------------------------------------------------
// 本地推理引擎（Ollama）：音效配方 / 节拍编曲 / 智能打标
// -------------------------------------------------------------

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://127.0.0.1:11437';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
const LOCAL_REASONING_ID = 'qwen-local-reasoning';

async function ollamaIsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 本地 LLM 结构化生成：Ollama format=JSON Schema 约束输出，返回解析后的对象 */
async function ollamaGenerateJson(prompt: string, schema: Record<string, any>, model = OLLAMA_MODEL): Promise<any> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false, // qwen3.5 为思考模型：关闭思考链，避免 token 预算被烧光导致正文为空
      format: schema,
      options: { temperature: 0.7, num_predict: 2500 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json() as any;
  const text = String(data?.message?.content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')  // 思考模型保险剥层
    .trim();
  const jsonStr = text.startsWith('{') ? text : (text.match(/\{[\s\S]*\}/)?.[0] ?? '');
  if (!jsonStr) {
    console.warn('Ollama 原始返回: done_reason=%s eval_count=%s thinking=%j content前300=%j',
      data?.done_reason, data?.eval_count, String(data?.message?.thinking ?? '').slice(0, 80), text.slice(0, 300));
    throw new Error('Ollama 未返回 JSON。');
  }
  return JSON.parse(jsonStr);
}

/** 推理引擎路由：显式本地选择 → Ollama；有 Gemini key 且模型为 gemini-* → 云端；否则 Ollama；再退回内置配方 */
async function resolveReasoningEngine(preferredModel?: string): Promise<'gemini' | 'ollama' | 'fallback'> {
  if (preferredModel === LOCAL_REASONING_ID) {
    return (await ollamaIsAvailable()) ? 'ollama' : 'fallback';
  }
  if (apiKey && (!preferredModel || preferredModel.startsWith('gemini'))) return 'gemini';
  if (await ollamaIsAvailable()) return 'ollama';
  return apiKey ? 'gemini' : 'fallback';
}

const SOUND_RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    category: { type: 'string' },
    duration: { type: 'number' },
    oscillators: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['sine', 'square', 'sawtooth', 'triangle'] },
          startFreq: { type: 'number' },
          endFreq: { type: 'number' },
          freqRamp: { type: 'string', enum: ['linear', 'exponential', 'none'] },
          detune: { type: 'number' },
          gain: { type: 'number' },
        },
        required: ['type', 'startFreq', 'gain'],
      },
    },
    envelope: {
      type: 'object',
      properties: { attack: { type: 'number' }, decay: { type: 'number' }, sustain: { type: 'number' }, release: { type: 'number' } },
      required: ['attack', 'decay', 'sustain', 'release'],
    },
    filter: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['lowpass', 'highpass', 'bandpass'] },
        startCutoff: { type: 'number' }, endCutoff: { type: 'number' }, q: { type: 'number' },
      },
    },
    noise: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['white', 'pink', 'brown'] }, gain: { type: 'number' }, duration: { type: 'number' } },
    },
    effects: {
      type: 'object',
      properties: { distortion: { type: 'number' }, reverb: { type: 'number' } },
    },
  },
  required: ['title', 'description', 'category', 'duration', 'oscillators', 'envelope'],
};

const MUSIC_PATTERN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    bpm: { type: 'number' },
    scale: { type: 'string' },
    tracks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          soundType: { type: 'string', enum: ['kick', 'snare', 'hihat', 'bass', 'lead'] },
          steps: { type: 'array', items: { type: 'boolean' } },
          notes: { type: 'array', items: { type: 'string' }, description: '16 个元素，无音符的步用空字符串' },
          volume: { type: 'number' },
        },
        required: ['id', 'name', 'soundType', 'steps', 'volume'],
      },
    },
  },
  required: ['name', 'bpm', 'scale', 'tracks'],
};

/** 把 LLM 输出的 pattern 规整成客户端期待的形状（16 步、notes 空串→null） */
function normalizePattern(pattern: any): any {
  const fix16 = (arr: any[], pad: any) => Array.from({ length: 16 }, (_, i) => (Array.isArray(arr) ? arr[i] : undefined) ?? pad);
  return {
    name: pattern?.name || 'AI 律动',
    bpm: Math.max(40, Math.min(220, Math.round(Number(pattern?.bpm) || 90))),
    scale: pattern?.scale || 'C Minor',
    tracks: (Array.isArray(pattern?.tracks) ? pattern.tracks : []).map((t: any, i: number) => ({
      id: t?.id || `t${i + 1}`,
      name: t?.name || `Track ${i + 1}`,
      soundType: ['kick', 'snare', 'hihat', 'bass', 'lead'].includes(t?.soundType) ? t.soundType : 'kick',
      steps: fix16(t?.steps, false),
      notes: Array.isArray(t?.notes) ? fix16(t.notes.map((n: any) => (n === '' || n == null ? null : n)), null) : undefined,
      volume: Math.max(0.1, Math.min(1, Number(t?.volume) || 0.8)),
    })),
  };
}

// -------------------------------------------------------------
// 本地转录引擎（Whisper-ASR Gradio 服务，端口 7861）
// -------------------------------------------------------------

const WHISPER_GRADIO_BASE = process.env.WHISPER_ASR_URL || 'http://127.0.0.1:7861';
const LOCAL_TRANSCRIBE_ID = 'whisper-local';

async function whisperIsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${WHISPER_GRADIO_BASE}/gradio_api/info`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 上传 WAV 到 Gradio → 调 transcribe → SSE 等待完成，返回 [文本, 语言, 时长] */
async function whisperTranscribe(wav: Buffer): Promise<{ transcript: string; language: string; duration: number }> {
  // 1. 文件上传
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
  const uploadRes = await fetch(`${WHISPER_GRADIO_BASE}/gradio_api/upload`, { method: 'POST', body: form });
  if (!uploadRes.ok) throw new Error(`Whisper 服务上传失败 (HTTP ${uploadRes.status})，请确认已双击 Whisper-ASR「启动网页版.command」。`);
  const [serverPath] = (await uploadRes.json()) as string[];
  if (!serverPath) throw new Error('Whisper 服务未返回文件路径。');

  // 2. 提交转写（Gradio 5 要求文件输入包成 FileData 对象，裸路径会被 pydantic 拒绝）
  const submitRes = await fetch(`${WHISPER_GRADIO_BASE}/gradio_api/call/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [{ path: serverPath, meta: { _type: 'gradio.FileData' } }, '自动'] }),
  });
  if (!submitRes.ok) throw new Error(`Whisper 服务提交失败 (HTTP ${submitRes.status})。`);
  const { event_id: eventId } = (await submitRes.json()) as { event_id?: string };
  if (!eventId) throw new Error('Whisper 服务未返回 event_id。');

  // 3. SSE 等待结果
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 600_000);
  try {
    const streamRes = await fetch(`${WHISPER_GRADIO_BASE}/gradio_api/call/transcribe/${eventId}`, { signal: abort.signal });
    if (!streamRes.ok || !streamRes.body) throw new Error(`Whisper 结果流获取失败 (HTTP ${streamRes.status})。`);
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const errorMatch = buffer.match(/event:\s*error\s*\ndata:\s*(.*)\s*\n/);
      if (errorMatch) throw new Error(`Whisper 转写失败: ${errorMatch[1].slice(0, 200)}`);
      const completeMatch = buffer.match(/event:\s*complete\s*\ndata:\s*(\[.*\])\s*\n/);
      if (completeMatch) {
        const [transcript, language, duration] = JSON.parse(completeMatch[1]);
        return { transcript: String(transcript || ''), language: String(language || '自动'), duration: Number(duration) || 0 };
      }
    }
    throw new Error('Whisper 结果流在完成前中断。');
  } finally {
    clearTimeout(timer);
  }
}

/** 转录引擎路由：显式本地选择 → Whisper；有 key 且 gemini 模型 → 云端；否则 Whisper；再退回模拟 */
async function resolveTranscribeEngine(preferredModel?: string): Promise<'whisper' | 'gemini' | 'fallback'> {
  if (preferredModel === LOCAL_TRANSCRIBE_ID) {
    return (await whisperIsAvailable()) ? 'whisper' : 'fallback';
  }
  if (apiKey && (!preferredModel || preferredModel.startsWith('gemini'))) return 'gemini';
  if (await whisperIsAvailable()) return 'whisper';
  return apiKey ? 'gemini' : 'fallback';
}

// -------------------------------------------------------------
// API Routes
// -------------------------------------------------------------

/**
 * 0. Voice Model Status & Configuration Info
 */
app.get('/api/voice-model/status', async (req, res) => {
  const engines = await Promise.all(
    ttsAdapters.map(async a => ({
      id: a.id,
      label: a.label,
      requiresApiKey: a.requiresApiKey,
      available: await a.isAvailable(),
    }))
  );
  // 本地推理/转录引擎一并上报，前端可据此提示是否需要先启动对应服务
  const [ollamaUp, whisperUp] = await Promise.all([ollamaIsAvailable(), whisperIsAvailable()]);
  engines.push(
    { id: LOCAL_REASONING_ID, label: `Qwen (Ollama ${OLLAMA_MODEL})`, requiresApiKey: false, available: ollamaUp },
    { id: LOCAL_TRANSCRIBE_ID, label: 'Whisper large-v3-turbo (本地)', requiresApiKey: false, available: whisperUp },
  );

  res.json({
    status: apiKey ? 'connected' : 'local_fallback',
    configured: Boolean(apiKey),
    engine: 'Google Gemini Audio Multimodal',
    models: {
      tts: 'gemini-2.5-flash-preview-tts',
      transcribe: 'gemini-2.5-flash',
      reasoning: 'gemini-2.5-flash',
    },
    engines,
    supportedVoices: [
      { id: 'Kore', name: 'Kore', gender: '男声', title: '权威男中音', tag: '沉稳睿智' },
      { id: 'Puck', name: 'Puck', gender: '男声', title: '朝气男高音', tag: '活力轻快' },
      { id: 'Fenrir', name: 'Fenrir', gender: '男声', title: '电影级重低音', tag: '磁性厚重' },
      { id: 'Charon', name: 'Charon', gender: '男声', title: '播音级标准音', tag: '专业播报' },
      { id: 'Zephyr', name: 'Zephyr', gender: '女声', title: '知性疗愈女声', tag: '温暖知性' },
    ],
    sampleRate: 24000,
    container: 'WAV (RIFF Header, 16-bit PCM)',
  });
});

/**
 * 1. AI Speech Synthesis (TTS)
 */
app.post('/api/generate-speech', async (req, res) => {
  try {
    const {
      text,
      voiceName = 'Kore',
      emotion,
      speed = 1.0,
      multiSpeaker = false,
      speakers = [],
      systemInstruction,
      temperature = 0.7,
      ttsModel = 'gemini-2.5-flash-preview-tts',
    } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text prompt is required.' });
    }

    if (ttsModel === 'web-speech-native') {
      return res.json({
        fallbackRequired: true,
        message: 'Client-side web speech selected.'
      });
    }

    const adapter = resolveTtsAdapter(ttsModel);

    if (adapter.requiresApiKey && !apiKey) {
      return res.status(400).json({
        error: 'Gemini API key is not configured.',
        fallbackRequired: true
      });
    }

    const result = await adapter.synthesize({
      text,
      voiceName,
      ttsModel,
      emotion,
      systemInstruction,
      speed,
      temperature,
      multiSpeaker,
      speakers,
    });

    res.json({
      success: true,
      audioUrl: `data:audio/wav;base64,${result.wavBase64}`,
      duration: Math.max(1, result.duration),
      sampleRate: result.sampleRate,
      format: 'wav',
      voiceName: result.voiceName,
      engine: adapter.id,
    });
  } catch (error: any) {
    console.error('Speech generation error:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate speech.',
      fallbackRequired: true,
    });
  }
});

/** 内置兜底音效配方（无任何引擎可用时） */
function defaultSfxRecipe(prompt: string, category: string) {
  return {
    title: prompt,
    description: `基于提示词 “${prompt}” 生成的程序化音效`,
    category: category || 'sfx',
    duration: 1.2,
    oscillators: [
      { type: 'sawtooth', startFreq: 440, endFreq: 110, freqRamp: 'exponential', gain: 0.7 },
      { type: 'sine', startFreq: 220, endFreq: 55, freqRamp: 'exponential', gain: 0.5 },
    ],
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 0.5 },
    filter: { type: 'lowpass', startCutoff: 3000, endCutoff: 400, q: 4 },
    noise: { type: 'white', gain: 0.15, duration: 0.3 },
    effects: { reverb: 0.3, distortion: 0.1 },
  };
}

/**
 * 2. Sound Effect (SFX) Recipe Generation
 */
app.post('/api/generate-sound-recipe', async (req, res) => {
  try {
    const { prompt, category = 'sci-fi', reasoningModel = 'gemini-2.5-flash' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Sound prompt is required.' });
    }

    const engine = await resolveReasoningEngine(reasoningModel);

    if (engine === 'ollama') {
      try {
        const recipe = await ollamaGenerateJson(
          `你是资深音效设计师与合成器程序员。为下面的描述设计一个 Web Audio API 程序化合成配方（JSON）。
描述：“${prompt}”（类别：${category}）。
要求：振荡器频率/扫频、包络、滤波曲线、噪声参数具体可信，组合起来能真实还原该音效；duration 在 0.3-5.0 秒之间。`,
          SOUND_RECIPE_SCHEMA
        );
        return res.json({ success: true, recipe, engine: `ollama:${OLLAMA_MODEL}` });
      } catch (e: any) {
        console.warn('Ollama SFX recipe failed, fallback:', e.message);
        return res.json({ success: true, recipe: defaultSfxRecipe(prompt, category), engine: 'fallback' });
      }
    }

    if (!apiKey) {
      // Fallback default recipe
      return res.json({ success: true, recipe: defaultSfxRecipe(prompt, category), engine: 'fallback' });
    }

    const modelToUse = reasoningModel || 'gemini-2.5-flash';

    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: `You are an expert audio sound designer and synthesizer programmer.
Create a Web Audio API procedural synthesis recipe for the following sound description: "${prompt}" (Category: ${category}).
Provide precise oscillator frequencies, envelopes, filter curves, and noise parameters that faithfully create this sound.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { type: Type.STRING },
            duration: { type: Type.NUMBER, description: 'Duration in seconds between 0.3 and 5.0' },
            oscillators: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ['sine', 'square', 'sawtooth', 'triangle'] },
                  startFreq: { type: Type.NUMBER },
                  endFreq: { type: Type.NUMBER },
                  freqRamp: { type: Type.STRING, enum: ['linear', 'exponential', 'none'] },
                  detune: { type: Type.NUMBER },
                  gain: { type: Type.NUMBER },
                },
                required: ['type', 'startFreq', 'gain'],
              },
            },
            envelope: {
              type: Type.OBJECT,
              properties: {
                attack: { type: Type.NUMBER },
                decay: { type: Type.NUMBER },
                sustain: { type: Type.NUMBER },
                release: { type: Type.NUMBER },
              },
              required: ['attack', 'decay', 'sustain', 'release'],
            },
            filter: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['lowpass', 'highpass', 'bandpass'] },
                startCutoff: { type: Type.NUMBER },
                endCutoff: { type: Type.NUMBER },
                q: { type: Type.NUMBER },
              },
            },
            noise: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['white', 'pink', 'brown'] },
                gain: { type: Type.NUMBER },
                duration: { type: Type.NUMBER },
              },
            },
            effects: {
              type: Type.OBJECT,
              properties: {
                distortion: { type: Type.NUMBER },
                reverb: { type: Type.NUMBER },
              },
            },
          },
          required: ['title', 'description', 'category', 'duration', 'oscillators', 'envelope'],
        },
      },
    });

    const jsonText = response.text?.trim() || '{}';
    const recipe = JSON.parse(jsonText);

    res.json({ success: true, recipe, engine: 'gemini' });
  } catch (error: any) {
    console.error('SFX recipe error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate sound recipe.' });
  }
});

/**
 * 3. AI Beat & Melody Pattern Generation
 */
app.post('/api/generate-music-pattern', async (req, res) => {
  try {
    const { prompt = 'Lo-Fi Chill Beat', bpm = 90, scale = 'C Minor', reasoningModel = 'gemini-2.5-flash' } = req.body;

    const engine = await resolveReasoningEngine(reasoningModel);

    if (engine === 'ollama') {
      try {
        const raw = await ollamaGenerateJson(
          `你是电子音乐制作人。根据提示生成 16 步鼓机律动（JSON）。
提示：“${prompt}”，目标 BPM: ${bpm}，调式: ${scale}。
必须恰好 5 轨：Kick Drum、Snare/Clap、Closed Hi-Hat、Sub Bass、Synth Lead。
每轨 steps 为恰好 16 个布尔值；Bass 与 Lead 另给 notes 数组（16 个元素，音名如 "C2"、"Eb2"、"G4"，无音符的步用空字符串 ""）。
鼓点要有节奏感和音乐性，Bass 走和弦根音，Lead 用调内音。`,
          MUSIC_PATTERN_SCHEMA
        );
        return res.json({ success: true, pattern: normalizePattern(raw), engine: `ollama:${OLLAMA_MODEL}` });
      } catch (e: any) {
        console.warn('Ollama music pattern failed, fallback:', e.message);
      }
    }

    if (!apiKey) {
      // Default fallback pattern
      return res.json({
        success: true,
        pattern: {
          name: prompt,
          bpm: bpm || 90,
          scale: scale || 'C Minor',
          tracks: [
            { id: 't1', name: 'Kick Drum', soundType: 'kick', steps: [true, false, false, false, true, false, false, false, true, false, false, false, false, false, true, false], volume: 0.9 },
            { id: 't2', name: 'Snare / Clap', soundType: 'snare', steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], volume: 0.8 },
            { id: 't3', name: 'Closed Hi-Hat', soundType: 'hihat', steps: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], volume: 0.6 },
            { id: 't4', name: 'Sub Bass', soundType: 'bass', steps: [true, false, false, false, false, true, false, false, true, false, false, false, false, true, false, false], notes: ['C2', null, null, null, null, 'Eb2', null, null, 'F2', null, null, null, null, 'G2', null, null], volume: 0.8 },
            { id: 't5', name: 'Synth Chords/Lead', soundType: 'lead', steps: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false], notes: ['C4', null, null, 'Eb4', null, null, 'G4', null, null, 'Bb4', null, null, 'C5', null, null, null], volume: 0.7 },
          ],
        },
      });
    }

    const modelToUse = reasoningModel || 'gemini-2.5-flash';

    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: `You are a talented electronic music producer. Generate a 16-step musical beat pattern based on the prompt: "${prompt}".
Target BPM: ${bpm}, Target Scale: ${scale}.
Return exactly 5 tracks: Kick Drum, Snare / Clap, Hi-Hat, Sub Bass, and Synth Lead/Pluck.
Each track must have an array of 16 booleans for 'steps', and for Bass and Lead, an optional array of 16 note strings (e.g. "C2", "Eb2", "G2" or null).`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            bpm: { type: Type.NUMBER },
            scale: { type: Type.STRING },
            tracks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  name: { type: Type.STRING },
                  soundType: { type: Type.STRING, enum: ['kick', 'snare', 'hihat', 'bass', 'lead'] },
                  steps: {
                    type: Type.ARRAY,
                    items: { type: Type.BOOLEAN },
                    description: 'Exactly 16 boolean values indicating step triggers',
                  },
                  notes: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING, nullable: true },
                    description: '16 elements with note names (like C2, Eb2, G3) or null',
                  },
                  volume: { type: Type.NUMBER },
                },
                required: ['id', 'name', 'soundType', 'steps', 'volume'],
              },
            },
          },
          required: ['name', 'bpm', 'scale', 'tracks'],
        },
      },
    });

    const jsonText = response.text?.trim() || '{}';
    const pattern = JSON.parse(jsonText);

    res.json({ success: true, pattern, engine: 'gemini' });
  } catch (error: any) {
    console.error('Music pattern error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate beat pattern.' });
  }
});

/**
 * 4. Audio Transcription & Analysis
 */
app.post('/api/transcribe-audio', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/wav', transcribeModel = 'gemini-2.5-flash' } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required.' });
    }

    const engine = await resolveTranscribeEngine(transcribeModel);

    if (engine === 'whisper') {
      try {
        const clean = String(audioBase64).replace(/^data:audio\/[a-z0-9]+;base64,/, '');
        const wav = Buffer.from(clean, 'base64');
        const { transcript, duration } = await whisperTranscribe(wav);

        // 本地 LLM 顺手做摘要/情绪/标签（不可用时给保守兜底）
        let summary = '本地 Whisper 转录结果';
        let mood = '清晰';
        let tags: string[] = ['转录', '人声'];
        if (await ollamaIsAvailable()) {
          try {
            const meta = await ollamaGenerateJson(
              `下面是一段音频的文字稿。请用一句话总结内容、判断整体情绪基调，并给出 3-5 个简洁的中文标签。\n文字稿：${transcript.slice(0, 800) || '（空）'}`,
              {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  mood: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
                required: ['summary', 'mood', 'tags'],
              }
            );
            summary = meta.summary || summary;
            mood = meta.mood || mood;
            tags = Array.isArray(meta.tags) && meta.tags.length ? meta.tags : tags;
          } catch (e: any) {
            console.warn('Ollama 转录后处理失败，使用兜底:', e.message);
          }
        }

        return res.json({ success: true, transcript, summary, mood, tags, duration, engine: 'whisper-local' });
      } catch (e: any) {
        console.warn('Whisper transcribe failed, fallback:', e.message);
        return res.status(502).json({
          error: e.message || '本地转录失败。',
          fallbackRequired: false,
        });
      }
    }

    if (!apiKey) {
      return res.json({
        success: true,
        transcript: '（本地模式转录模拟：音频录制清晰，音色明亮，适合用作语音素材）',
        summary: '测试音频样本',
        mood: '清晰/平静',
        tags: ['录音', '人声', '原声'],
        engine: 'fallback',
      });
    }

    const cleanBase64 = audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
    const modelToUse = transcribeModel || 'gemini-2.5-flash';

    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: [
        {
          inlineData: {
            mimeType: mimeType.split(';')[0],
            data: cleanBase64,
          },
        },
        {
          text: `Please transcribe this audio accurately. Also identify the emotional mood and extract 4-6 descriptive tags.
Output your response in JSON with:
{
  "transcript": "Exact transcription text",
  "summary": "1 sentence brief summary",
  "mood": "Detected mood or tone",
  "tags": ["tag1", "tag2", "tag3"]
}`,
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json({ success: true, ...parsed });
  } catch (error: any) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: error.message || 'Transcription failed.' });
  }
});

/**
 * 5. Auto-Tag and Categorization
 */
app.post('/api/auto-tag-audio', async (req, res) => {
  try {
    const { title, description, category, transcript } = req.body;

    const engine = await resolveReasoningEngine(req.body?.reasoningModel);

    if (engine === 'ollama') {
      try {
        const parsed = await ollamaGenerateJson(
          `根据以下音频素材元数据生成 4-6 个简洁有用的中文标签（用于素材库搜索与整理，如“科技感”“低音轰鸣”“快节奏”“游戏UI”“热情解说”），并给一句更精炼的描述。
标题：${title}
描述：${description || '（无）'}
类别：${category || '未分类'}
文字稿：${(transcript || '（无）').slice(0, 500)}`,
          {
            type: 'object',
            properties: {
              tags: { type: 'array', items: { type: 'string' } },
              refinedDescription: { type: 'string' },
            },
            required: ['tags'],
          }
        );
        return res.json({ success: true, tags: parsed.tags || [], description: parsed.refinedDescription, engine: `ollama:${OLLAMA_MODEL}` });
      } catch (e: any) {
        console.warn('Ollama auto-tag failed, fallback:', e.message);
      }
    }

    if (!apiKey) {
      return res.json({
        tags: ['高清音质', '素材', category || '音频'],
        category: category || 'sample',
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Given the following audio metadata:
Title: ${title}
Description: ${description || ''}
Category: ${category}
Transcript: ${transcript || ''}

Generate 4-6 concise, useful Chinese tags for library search and organization (e.g. "科技感", "低音轰鸣", "快节奏", "游戏UI", "热情解说").`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            refinedDescription: { type: Type.STRING },
          },
          required: ['tags'],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json({ success: true, tags: parsed.tags || [], description: parsed.refinedDescription });
  } catch (error: any) {
    console.error('Auto tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// Library API (素材库：SQLite 元数据 + 磁盘文件)
// -------------------------------------------------------------

/** 列出全部素材 */
app.get('/api/library/items', (_req, res) => {
  res.json({ items: listItems() });
});

/**
 * 新建/覆盖素材。body: { item, audioBase64? }
 * audioBase64 带 data: 前缀亦可（data:audio/wav;base64,....）
 */
app.post('/api/library/items', (req, res) => {
  try {
    const { item, audioBase64 } = req.body || {};
    if (!item || !item.id) {
      return res.status(400).json({ error: 'item (含 id) is required.' });
    }

    let payload = { ...item };
    if (audioBase64) {
      const clean = String(audioBase64).replace(/^data:audio\/[a-z0-9]+;base64,/, '');
      const buf = Buffer.from(clean, 'base64');
      writeItemFile(String(item.id), item.format || 'wav', buf);
      payload = { ...payload, fileSize: buf.length };
    }

    const saved = saveItem(payload);
    res.json({ item: saved });
  } catch (error: any) {
    console.error('Library save error:', error);
    res.status(500).json({ error: error.message || 'Failed to save item.' });
  }
});

/** 部分更新素材元数据 */
app.patch('/api/library/items/:id', (req, res) => {
  const updated = updateItem(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Item not found.' });
  res.json({ item: updated });
});

/** 删除单个素材（含磁盘文件） */
app.delete('/api/library/items/:id', (req, res) => {
  const ok = deleteItem(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Item not found.' });
  res.json({ items: listItems() });
});

/** 批量删除 */
app.post('/api/library/items/batch-delete', (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  for (const id of ids) deleteItem(id);
  res.json({ items: listItems() });
});

/** 批量移动到文件夹（folderId 为 null/undefined = 未分类） */
app.post('/api/library/move', (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const folderId = req.body?.folderId ?? null;
  for (const id of ids) updateItem(id, { folderId });
  res.json({ items: listItems() });
});

/** 批量追加标签 */
app.post('/api/library/tags', (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const newTags: string[] = Array.isArray(req.body?.tags) ? req.body.tags : [];
  for (const id of ids) {
    const current = getItem(id);
    if (!current) continue;
    const merged = Array.from(new Set([...(current.tags || []), ...newTags]));
    updateItem(id, { tags: merged });
  }
  res.json({ items: listItems() });
});

/** 素材音频文件（res.sendFile 自带 Range 分段播放支持） */
app.get('/api/library/file/:id', (req, res) => {
  const file = readItemFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'Audio file not found.' });
  const mime = file.fileName.endsWith('.wav') ? 'audio/wav'
    : file.fileName.endsWith('.mp3') ? 'audio/mpeg'
    : file.fileName.endsWith('.webm') ? 'audio/webm'
    : file.fileName.endsWith('.ogg') ? 'audio/ogg'
    : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.sendFile(file.filePath);
});

/** 列出文件夹（空库自动播种默认文件夹） */
app.get('/api/library/folders', (_req, res) => {
  res.json({ folders: listFolders() });
});

/** 新建/更新文件夹 */
app.post('/api/library/folders', (req, res) => {
  try {
    const { id, name, color, createdAt } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id and name are required.' });
    const folder = saveFolder({ id, name, color, createdAt });
    res.json({ folder, folders: listFolders() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save folder.' });
  }
});

/** 整表替换文件夹（迁移用） */
app.post('/api/library/folders/replace', (req, res) => {
  try {
    const folders = Array.isArray(req.body?.folders) ? req.body.folders : [];
    res.json({ folders: replaceFolders(folders) });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to replace folders.' });
  }
});

/** 删除文件夹（素材保留并归入未分类） */
app.delete('/api/library/folders/:id', (req, res) => {
  deleteFolder(req.params.id);
  res.json({ folders: listFolders() });
});

// -------------------------------------------------------------
// Vite Dev Server or Production Static Serving
// -------------------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AudioCraft Studio running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
