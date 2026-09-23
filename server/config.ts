/**
 * Semovix Voice Studio - 服务端配置
 * 全部通过懒加载读取环境变量，保证 dotenv.config() 在 server.ts 入口先于首次取值执行，
 * 同时允许测试在 import 前注入 SEMOVIX_LIBRARY_DIR 等覆盖项。
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '..');

export interface AppConfig {
  port: number;
  geminiApiKey: string;
  /** 本地 Qwen3-TTS Gradio 服务地址（P3 将替换为 FastAPI Worker） */
  qwenTtsUrl: string;
  /** 本地 Ollama 推理服务地址 */
  ollamaUrl: string;
  ollamaModel: string;
  /** 本地 Whisper Gradio 服务地址（P3 将替换为 FastAPI Worker） */
  whisperAsrUrl: string;
  /** 素材库根目录（SQLite + 音频文件），可用 SEMOVIX_LIBRARY_DIR 覆盖（测试用） */
  libraryDir: string;
  isProduction: boolean;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  cached = {
    port: Number(process.env.PORT) || 3000,
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    qwenTtsUrl: process.env.QWEN_TTS_URL || 'http://127.0.0.1:7860',
    ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11437',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen3.5:9b',
    whisperAsrUrl: process.env.WHISPER_ASR_URL || 'http://127.0.0.1:7861',
    libraryDir: process.env.SEMOVIX_LIBRARY_DIR || path.join(PROJECT_ROOT, 'library'),
    isProduction: process.env.NODE_ENV === 'production',
  };
  return cached;
}

/** 测试专用：清空缓存以便重新注入环境变量 */
export function resetConfigCache(): void {
  cached = null;
}
