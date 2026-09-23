/**
 * TTS Engine Adapter Layer (可插拔语音引擎)（自 server.ts 原样迁移）
 * 每个本地/云端引擎实现同一个接口；按请求里的 ttsModel 路由。
 * 新增引擎：实现 TTSEngineAdapter → push 进 ttsAdapters → 前端模型列表加一项。
 */
import { Modality } from '@google/genai';
import { getConfig } from '../config';
import { pcmToWavBuffer, wavDuration, concatWavBuffers } from '../audio/wav';
import { applySpeedToWav } from '../audio/wsola';
import { getGeminiClient, hasGeminiApiKey } from './geminiClient';

export interface TTSSynthesizeRequest {
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

export interface TTSSynthesizeResult {
  wavBase64: string;
  sampleRate: number;
  duration: number; // seconds
  voiceName: string;
}

export interface TTSEngineAdapter {
  id: string;
  label: string;
  requiresApiKey: boolean;
  isAvailable(): Promise<boolean>;
  synthesize(req: TTSSynthesizeRequest): Promise<TTSSynthesizeResult>;
}

/* ---------- Adapter: Google Gemini (云端) ---------- */

export const geminiAdapter: TTSEngineAdapter = {
  id: 'gemini',
  label: 'Google Gemini Audio',
  requiresApiKey: true,
  isAvailable: async () => hasGeminiApiKey(),
  async synthesize(req) {
    const ai = getGeminiClient();
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

/** 调 Gradio /run_instruct 合成一段音频，返回完整 WAV Buffer */
async function qwenGradioSynthesizeOnce(text: string, speaker: string, instruct: string | null): Promise<Buffer> {
  const QWEN_GRADIO_BASE = getConfig().qwenTtsUrl;
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

/** 拼接多段同格式 WAV，段间可插入静音（迁移自 server.ts；P1-c3 改用可靠解析） */

export const qwenLocalAdapter: TTSEngineAdapter = {
  id: 'qwen3-tts-local',
  label: 'Qwen3-TTS 1.7B (本地)',
  requiresApiKey: false,
  isAvailable: async () => {
    try {
      const res = await fetch(`${getConfig().qwenTtsUrl}/gradio_api/info`, { signal: AbortSignal.timeout(3000) });
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

export const ttsAdapters: TTSEngineAdapter[] = [geminiAdapter, qwenLocalAdapter];

export function resolveTtsAdapter(ttsModel?: string): TTSEngineAdapter {
  if (ttsModel === qwenLocalAdapter.id) return qwenLocalAdapter;
  return geminiAdapter; // 其余模型 ID 均走 Gemini 家族
}
