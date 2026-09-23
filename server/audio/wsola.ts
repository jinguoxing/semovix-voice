/**
 * WSOLA 时长伸缩（16bit mono PCM）：speed > 1 加快、< 1 放慢，音高不变。
 * 经典算法——Hann 窗 50% 重叠相加，分析步进随 speed 缩放，
 * 每帧在 ±delta 内搜索与上一帧“自然延续”相关性最佳的对齐点，消除相位断裂。
 * （自 server.ts 原样迁移）
 */
import { pcmToWavBuffer, extractPcm16, WavParseError } from './wav';

/** 立体声/多声道 16-bit PCM → 单声道（平均下混），供 WSOLA 处理。 */
function downmixToMono(pcm: Buffer, channels: number): Buffer {
  if (channels === 1) return pcm;
  const frames = Math.floor(pcm.length / 2 / channels);
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((i * channels + c) * 2);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / channels))), i * 2);
  }
  return out;
}

export function wsolaTimeStretch(pcm: Buffer, speed: number): Buffer {
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

/**
 * 对整段 WAV 施加语速（可靠解析 → 16bit PCM 单声道化 → WSOLA → 重新封包）。
 * 输出保持输入的采样率；多声道输入下混为单声道（WSOLA 仅支持单声道）。
 * @throws WavParseError 输入不是 16-bit PCM WAV
 */
export function applySpeedToWav(wav: Buffer, speed?: number, _legacySampleRate?: number): Buffer {
  const s = Number(speed) || 1;
  if (Math.abs(s - 1) < 0.03) return wav;
  const { pcm, info } = extractPcm16(wav);
  const mono = downmixToMono(pcm, info.format.channels);
  const stretched = wsolaTimeStretch(mono, s);
  return pcmToWavBuffer(stretched, info.format.sampleRate, 1, 16);
}
