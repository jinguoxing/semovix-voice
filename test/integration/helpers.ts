/**
 * 集成测试环境装配：
 * - 临时素材库目录（每测试文件独立，避免污染真实 library/）
 * - 显式清除 GEMINI_API_KEY，保证不会发生真实云端调用
 * - fetch 全局打桩为“网络不可达”，引擎可用性探测结果确定（全部不可用）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

export interface TestEnv {
  libraryDir: string;
  createApp: typeof import('../../server/app').createApp;
}

export async function setupTestEnv(): Promise<TestEnv> {
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semovix-it-'));
  process.env.SEMOVIX_LIBRARY_DIR = libraryDir;
  delete process.env.GEMINI_API_KEY;
  delete process.env.SEMOVIX_WORKER_URL;
  delete process.env.OLLAMA_URL;

  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network disabled in integration tests');
  }));

  const { createApp } = await import('../../server/app');
  const { resetConfigCache } = await import('../../server/config');
  resetConfigCache();

  return { libraryDir, createApp };
}

export function cleanupTestEnv(libraryDir: string): void {
  fs.rmSync(libraryDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
}

/** 生成一段最小合法 16-bit PCM WAV 的 Buffer（multipart 上传测试用） */
export function tinyWavBuffer(sampleRate = 24000, frames = 240): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + frames * 2, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(frames * 2, 40);
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2);
  return Buffer.concat([header, pcm]);
}

/** 同上，base64 形式（校验服务端拒绝 JSON Base64 通道时用） */
export function tinyWavBase64(sampleRate = 24000, frames = 240): string {
  return tinyWavBuffer(sampleRate, frames).toString('base64');
}
