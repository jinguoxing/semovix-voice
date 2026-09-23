/**
 * Python FastAPI Worker 客户端（硬性约束 #14）
 *
 * Node 后端经此模块与 worker/ 通信：Qwen3-TTS 合成、Whisper 转录、官方音色目录。
 * 音频传输全部走字节流/文件（TTS 响应为 WAV 字节、ASR 请求为 multipart），不走 JSON Base64（硬性约束 #7）。
 * Qwen speaker 必须是模型运行时返回的官方精确 ID（如 uncle_fu），目录以外一律拒绝（硬性约束 #6）。
 */
import { getConfig } from '../config';
import { EngineValidationError } from './errors';

export interface WorkerHealth {
  ok: boolean;
  engines: {
    qwen_tts: { available: boolean; loading: boolean; error: string | null; checkpoint: string };
    whisper_asr: { available: boolean; loading: boolean; error: string | null; model: string };
  };
}

export interface QwenVoiceCatalog {
  speakers: string[]; // 官方精确 ID（下划线式）
  languages: string[];
}

const CATALOG_TTL_MS = 60_000;
let catalogCache: (QwenVoiceCatalog & { fetchedAt: number }) | null = null;

function workerUrl(): string {
  return getConfig().workerUrl;
}

/** Worker 健康状态；进程不可达时返回 null（不抛错，调用方据此如实上报 unavailable） */
export async function workerHealth(): Promise<WorkerHealth | null> {
  try {
    const res = await fetch(`${workerUrl()}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return (await res.json()) as WorkerHealth;
  } catch {
    return null;
  }
}

/**
 * 官方音色目录（带 60s 内存缓存；获取失败时回退上次成功值，可能为 null）。
 * 目录为 null 时调用方不得猜测 speaker——交给 worker 权威校验。
 */
export async function qwenVoiceCatalog(): Promise<QwenVoiceCatalog | null> {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return { speakers: catalogCache.speakers, languages: catalogCache.languages };
  }
  try {
    const res = await fetch(`${workerUrl()}/voices`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return catalogCache ? { speakers: catalogCache.speakers, languages: catalogCache.languages } : null;
    const data = (await res.json()) as QwenVoiceCatalog;
    catalogCache = { fetchedAt: Date.now(), speakers: data.speakers ?? [], languages: data.languages ?? [] };
    return { speakers: catalogCache.speakers, languages: catalogCache.languages };
  } catch {
    return catalogCache ? { speakers: catalogCache.speakers, languages: catalogCache.languages } : null;
  }
}

export class UnsupportedQwenSpeakerError extends EngineValidationError {
  constructor(readonly speaker: string, speakers: string[]) {
    super(
      `非官方 Qwen speaker ID: ${speaker}（官方: ${speakers.join(', ')}）。请使用 /api/voice-model/status 返回的 qwen3Tts 音色目录。`,
      'unsupported_speaker',
      { speakers }
    );
    this.name = 'UnsupportedQwenSpeakerError';
  }
}

/**
 * 校验 speaker 是否为官方精确 ID（硬性约束 #5/#6：Google Voice ID 与 Qwen Speaker ID 不得混用）。
 * catalog 为 null（worker 目录不可得）时原样放行，由 worker 做最终权威校验。
 */
export function resolveQwenSpeaker(speaker: string, catalog: QwenVoiceCatalog | null): string {
  if (!catalog || catalog.speakers.length === 0) return speaker;
  if (catalog.speakers.includes(speaker)) return speaker;
  throw new UnsupportedQwenSpeakerError(speaker, catalog.speakers);
}

async function workerError(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { detail?: { error?: string; code?: string; speakers?: string[] } };
    const d = body.detail ?? {};
    if (d.code === 'unsupported_speaker' && d.speakers) {
      return new UnsupportedQwenSpeakerError(String(d.error?.match(/: (.*?)[（(]/)?.[1] ?? d.error ?? 'unsupported speaker'), d.speakers);
    }
    return new Error(d.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

/** 合成一段语音，返回完整 WAV Buffer */
export async function qwenWorkerSynthesize(req: {
  text: string;
  speaker: string;
  language?: string;
  instruct?: string | null;
}): Promise<Buffer> {
  const res = await fetch(`${workerUrl()}/tts/qwen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: req.text,
      speaker: req.speaker,
      language: req.language || 'Auto',
      instruct: req.instruct ?? null,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw await workerError(res, `Qwen Worker 合成失败 (HTTP ${res.status})。请确认 worker/ 已启动（双击「启动Worker.command」）。`);
  return Buffer.from(await res.arrayBuffer());
}

/** Whisper 转录（multipart 文件上传，硬性约束 #7） */
export async function whisperWorkerTranscribe(
  wav: Buffer,
  language: 'auto' | 'zh' | 'en' = 'auto'
): Promise<{ transcript: string; language: string; duration: number }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
  form.append('language', language);

  const res = await fetch(`${workerUrl()}/asr/whisper`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw await workerError(res, `Whisper Worker 转录失败 (HTTP ${res.status})。请确认 worker/ 已启动。`);
  const data = (await res.json()) as { transcript?: string; language?: string; duration?: number };
  return {
    transcript: String(data.transcript ?? ''),
    language: String(data.language ?? language),
    duration: Number(data.duration) || 0,
  };
}
