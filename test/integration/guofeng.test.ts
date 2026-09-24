import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
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

describe('POST /api/generate-guofeng-composition', () => {
  it('returns an editable score and names its actual offline generator', async () => {
    const res = await request(app).post('/api/generate-guofeng-composition').send({
      prompt: '月下山水', mood: '空灵', scene: '山水', durationSec: 20,
      bpm: 96, key: 0, scale: 'major-pentatonic', instruments: ['guzheng', 'dizi', 'drum'],
    }).expect(200);
    expect(res.body.engine).toBe('rules');
    expect(res.body.composition.generator).toBe('rules');
    expect(res.body.warning).toMatch(/未检测到可用旋律模型/);
    expect(res.body.composition.sections.map((section: { id: string }) => section.id)).toEqual(['intro', 'theme', 'outro']);
    expect(res.body.composition.sections[1].notes.length).toBeGreaterThan(0);
  });

  it('rejects missing instruments and out-of-range duration', async () => {
    await request(app).post('/api/generate-guofeng-composition').send({ prompt: '山水', durationSec: 20, bpm: 96, instruments: [] }).expect(400);
    await request(app).post('/api/generate-guofeng-composition').send({ prompt: '山水', durationSec: 120, bpm: 96, instruments: ['dizi'] }).expect(400);
  });

  it('labels an empty model response as a rules fallback, not AI music', async () => {
    const offlineFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/api/tags')
        ? { models: [{ name: 'local' }] }
        : { message: { content: JSON.stringify({ phrase: [], answer: [] }) } },
    })));
    try {
      const res = await request(app).post('/api/generate-guofeng-composition').send({
        prompt: '月下山水', mood: '空灵', scene: '山水', durationSec: 20,
        bpm: 96, key: 0, scale: 'major-pentatonic', instruments: ['guzheng', 'dizi'],
        reasoningModel: 'qwen-local-reasoning',
      }).expect(200);
      expect(res.body.engine).toBe('rules');
      expect(res.body.composition.generator).toBe('rules');
      expect(res.body.warning).toMatch(/内置编曲模板/);
    } finally {
      vi.stubGlobal('fetch', offlineFetch);
    }
  });
});
