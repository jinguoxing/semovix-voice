/**
 * 通用 API 集成测试：引擎状态上报、TTS 参数校验（全部离线、禁网）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestEnv, cleanupTestEnv } from './helpers';

let app: Express;
let libraryDir: string;

beforeAll(async () => {
  const env = await setupTestEnv();
  app = env.createApp();
  libraryDir = env.libraryDir;
});

afterAll(() => cleanupTestEnv(libraryDir));

describe('GET /api/voice-model/status', () => {
  it('reports engine catalog with deterministic availability (network disabled)', async () => {
    const res = await request(app).get('/api/voice-model/status').expect(200);
    expect(res.body.status).toBe('local_fallback');
    expect(res.body.configured).toBe(false);

    const engines = res.body.engines as Array<{ id: string; available: boolean }>;
    const ids = engines.map(e => e.id);
    expect(ids).toContain('gemini');
    expect(ids).toContain('qwen3-tts-local');
    expect(ids).toContain('qwen-local-reasoning');
    expect(ids).toContain('whisper-local');
    // fetch 已打桩为不可达：所有引擎 available=false，不得伪造可用
    for (const e of engines) expect(e.available).toBe(false);
  });
});

describe('POST /api/generate-speech (validation only, no engine calls)', () => {
  it('rejects missing text with 400', async () => {
    const res = await request(app)
      .post('/api/generate-speech')
      .send({ voiceName: 'Kore' })
      .expect(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns client-fallback directive for web-speech-native without engine call', async () => {
    const res = await request(app)
      .post('/api/generate-speech')
      .send({ text: '你好', ttsModel: 'web-speech-native' })
      .expect(200);
    expect(res.body.fallbackRequired).toBe(true);
    expect(res.body.audioUrl).toBeUndefined();
  });

  it('rejects gemini models when no API key is configured (no fake audio)', async () => {
    const res = await request(app)
      .post('/api/generate-speech')
      .send({ text: '你好', ttsModel: 'gemini-2.5-flash-preview-tts' })
      .expect(400);
    expect(res.body.error).toMatch(/API key/i);
    expect(res.body.fallbackRequired).toBe(true);
    expect(res.body.audioUrl).toBeUndefined(); // 硬性约束：不得伪造成功结果
  });
});
