/**
 * Gemini 客户端懒加载单例（自 server.ts 抽出）。
 * API key 经 config 懒读取，避免模块加载期早于 dotenv 读取环境变量。
 */
import { GoogleGenAI } from '@google/genai';
import { getConfig } from '../config';

export function hasGeminiApiKey(): boolean {
  return Boolean(getConfig().geminiApiKey);
}

let client: GoogleGenAI | null = null;
let clientKey = '';

export function getGeminiClient(): GoogleGenAI {
  const apiKey = getConfig().geminiApiKey;
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    clientKey = apiKey;
  }
  return client;
}
