/**
 * 本地转录引擎（Whisper large-v3-turbo，经 Python FastAPI Worker，硬性约束 #14）
 * P3：不再直连 Gradio；音频经 multipart 文件上传（硬性约束 #7）。
 */
import { hasGeminiApiKey } from './geminiClient';
import { workerHealth, whisperWorkerTranscribe } from './qwenWorker';

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

export async function whisperIsAvailable(): Promise<boolean> {
  const health = await workerHealth();
  return health?.engines.whisper_asr.available ?? false;
}

/** 上传 WAV 到 Worker → 返回 { 文本, 语言, 时长 } */
export async function whisperTranscribe(
  wav: Buffer,
  language: 'auto' | 'zh' | 'en' = 'auto'
): Promise<{ transcript: string; language: string; duration: number }> {
  return whisperWorkerTranscribe(wav, language);
}

/**
 * 转录引擎路由：显式本地选择 → Whisper；有 key 且 gemini 模型 → 云端；否则 Whisper；
 * 全部不可用返回 'fallback'（P2 起 'fallback' 不再产生模拟文本，由路由转为 503，硬性约束 #3）
 */
export async function resolveTranscribeEngine(preferredModel?: string): Promise<'whisper' | 'gemini' | 'fallback'> {
  if (preferredModel === LOCAL_TRANSCRIBE_ID) {
    return (await whisperIsAvailable()) ? 'whisper' : 'fallback';
  }
  if (hasGeminiApiKey() && (!preferredModel || GEMINI_TRANSCRIBE_MODELS.includes(preferredModel))) return 'gemini';
  if (await whisperIsAvailable()) return 'whisper';
  return hasGeminiApiKey() ? 'gemini' : 'fallback';
}
