/**
 * 本地转录引擎（Whisper large-v3-turbo，经 Python FastAPI Worker，硬性约束 #14）
 * P3：不再直连 Gradio；音频经 multipart 文件上传（硬性约束 #7）。
 * P01：接入冷启动状态机——Whisper 尚未加载（cold/loading）不再判为不可用，
 *      调用前 waitForWorkerEngineReady 触发预热并等待就绪。
 */
import { hasGeminiApiKey } from './geminiClient';
import { getWorkerStatus, waitForWorkerEngineReady, whisperWorkerTranscribe } from './qwenWorker';

export const LOCAL_TRANSCRIBE_ID = 'whisper-local';

/** 允许转发给 Gemini 的转录模型 ID（硬性约束 #4：未知 ID 不得默认发给 Gemini） */
export const GEMINI_TRANSCRIBE_MODELS: readonly string[] = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
];

export const SUPPORTED_TRANSCRIBE_MODELS: readonly string[] = [
  LOCAL_TRANSCRIBE_ID,
  ...GEMINI_TRANSCRIBE_MODELS,
];

export function isSupportedTranscribeModel(model?: string): boolean {
  return !model || SUPPORTED_TRANSCRIBE_MODELS.includes(model);
}

/** 仅供状态面板使用：模型已加载（ready）才算可用 */
export async function whisperIsAvailable(): Promise<boolean> {
  const status = await getWorkerStatus();
  return status.reachable && status.whisper_asr.state === 'ready';
}

/** Worker 进程可达（引擎可能还在加载，调用链会等待就绪） */
export async function whisperWorkerReachable(): Promise<boolean> {
  return (await getWorkerStatus()).reachable;
}

/** 上传 WAV 到 Worker → 返回 { 文本, 语言, 时长 }；先等引擎就绪（cold → 自动预热） */
export async function whisperTranscribe(
  wav: Buffer,
  language: 'auto' | 'zh' | 'en' = 'auto'
): Promise<{ transcript: string; language: string; duration: number }> {
  await waitForWorkerEngineReady('whisper_asr');
  return whisperWorkerTranscribe(wav, language);
}

/**
 * 转录引擎路由：显式本地选择 → Whisper；有 key 且 gemini 模型 → 云端；否则 Whisper；
 * Worker 进程可达即选 Whisper（引擎未加载由调用链等待，P01）；
 * 全部不可用返回 'fallback'（P2 起 'fallback' 不再产生模拟文本，由路由转为 503，硬性约束 #3）
 */
export async function resolveTranscribeEngine(preferredModel?: string): Promise<'whisper' | 'gemini' | 'fallback'> {
  if (preferredModel === LOCAL_TRANSCRIBE_ID) {
    return (await whisperWorkerReachable()) ? 'whisper' : 'fallback';
  }
  if (hasGeminiApiKey() && (!preferredModel || GEMINI_TRANSCRIBE_MODELS.includes(preferredModel))) return 'gemini';
  if (await whisperWorkerReachable()) return 'whisper';
  return hasGeminiApiKey() ? 'gemini' : 'fallback';
}
