import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

vi.mock('../../server/engines/qwenWorker', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/engines/qwenWorker')>();
  return {
    ...original,
    waitForWorkerEngineReady: vi.fn(async () => undefined),
    qwenWorkerVoiceDesign: vi.fn(async () => Buffer.from('RIFFtest-wave')),
  };
});

const snapshot = {
  identityId: 'new-demo', identityName: '示例声音角色',
  brief: '专业、可信的中文讲解声音。', reference: '这是一段统一参考文本。',
  forbidden: ['广告推销感'],
  directions: [
    { id: 'A', name: '专业型', description: '稳健理性', features: ['稳健'] },
    { id: 'B', name: '亲和型', description: '自然温和', features: ['亲和'] },
  ],
  candidatesPerDirection: 1, language: '中文（普通话）', fixedSeed: true, seed: '20260924',
};

describe('VoiceDesign batch API', () => {
  let directory: string;
  let app: express.Express;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-design-api-'));
    process.env.SEMOVIX_LIBRARY_DIR = directory;
    const { resetConfigCache } = await import('../../server/config');
    resetConfigCache();
    const { voiceDesignRouter } = await import('../../server/routes/voiceDesign');
    app = express();
    app.use(express.json());
    app.use('/api', voiceDesignRouter);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.SEMOVIX_LIBRARY_DIR;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('rejects incomplete designs and refuses to create a batch when the Worker lacks VoiceDesign', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ engines: { qwen_tts: { state: 'ready' } } }), { status: 200 })));
    expect((await request(app).post('/api/voice-design/batches').send({})).status).toBe(400);
    const unavailable = await request(app).post('/api/voice-design/batches').send(snapshot);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe('voice_design_unavailable');
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('creates an immutable batch snapshot and persists generated candidates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ engines: { voice_design: { state: 'ready' } } }), { status: 200 })));
    const created = await request(app).post('/api/voice-design/batches').send(snapshot);
    expect(created.status).toBe(202);
    expect(created.body.label).toMatch(/^Batch \d{8}-01$/);
    expect(created.body.totalCount).toBe(2);

    let result = await request(app).get(`/api/voice-design/batches/${created.body.id}`);
    for (let i = 0; i < 30 && result.body.status !== 'completed'; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      result = await request(app).get(`/api/voice-design/batches/${created.body.id}`);
    }
    expect(result.body.status).toBe('completed');
    expect(result.body.completedCount).toBe(2);
    expect(result.body.snapshot.model).toBe('Qwen3-TTS-12Hz-1.7B-VoiceDesign');
    expect(result.body.snapshot.reference).toBe(snapshot.reference);
    expect(result.body.candidates.map((item: { seed: number }) => item.seed)).toEqual([20260924, 20260924]);

    const audio = await request(app).get(`/api/voice-design/batches/${created.body.id}/candidates/A-01/audio`);
    expect(audio.status).toBe(200);
    expect(audio.body.toString()).toContain('RIFF');
  });
});
