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
  /** Python FastAPI Worker（Qwen3-TTS + Whisper）地址，硬性约束 #14 */
  workerUrl: string;
  /** 本地 Ollama 推理服务地址 */
  ollamaUrl: string;
  ollamaModel: string;
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
    workerUrl: process.env.SEMOVIX_WORKER_URL || 'http://127.0.0.1:8800',
    // Ollama 统一默认端口 11434；非默认部署（如本机 11437）用 OLLAMA_URL 覆盖
    ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen3.5:9b',
    libraryDir: process.env.SEMOVIX_LIBRARY_DIR || path.join(PROJECT_ROOT, 'library'),
    isProduction: process.env.NODE_ENV === 'production',
  };
  return cached;
}

/** 测试专用：清空缓存以便重新注入环境变量 */
export function resetConfigCache(): void {
  cached = null;
}
