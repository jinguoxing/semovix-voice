import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resetConfigCache } from '../../server/config';
import { voiceLifecycleRouter } from '../../server/routes/voiceLifecycle';

const batchId = '20260925-01';
const identityId = 'new-demo';
const scores = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, [4, 4, 4, 4, 4, 4, 4]]));
scores[2] = [5, 4, 5, 4, 4, 5, 4];
scores[7] = [4, 4, 4, 5, 4, 4, 5];
scores[11] = [4, 4, 4, 4, 4, 5, 4];

describe('Voice identity lifecycle API', () => {
  let directory: string;
  let app: express.Express;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-lifecycle-api-'));
    process.env.SEMOVIX_LIBRARY_DIR = directory;
    resetConfigCache();
    const batchDirectory = path.join(directory, 'voice-design-batches', batchId);
    await fs.mkdir(batchDirectory, { recursive: true });
    await fs.writeFile(path.join(batchDirectory, 'batch.json'), JSON.stringify({
      id: batchId,
      status: 'completed',
      totalCount: 12,
      snapshot: {
        identityId,
        identityName: '示例声音角色',
        model: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign',
        language: '中文（普通话）',
        reference: '这是一段统一参考文本。',
      },
    }));
    app = express();
    app.use(express.json());
    app.use('/api', voiceLifecycleRouter);
  });

  afterEach(async () => {
    delete process.env.SEMOVIX_LIBRARY_DIR;
    resetConfigCache();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('persists review and validation before freezing an immutable Voice Profile', async () => {
    const review = await request(app).put(`/api/voice-design/batches/${batchId}/review`).send({
      identityId,
      finalists: [2, 7, 11],
      eliminated: [4, 9],
      vetoes: {},
      scores,
      note: '身份稳定，适合进入验证。',
      tags: ['身份稳定'],
    }).expect(200);
    expect(review.body.review.finalists).toEqual([2, 7, 11]);

    await request(app).put(`/api/voice-design/batches/${batchId}/validation`).send({
      identityId,
      candidateId: 2,
      profileName: '官方讲解员 V1',
      profileVersion: 'V1.0',
    }).expect(200);

    const frozen = await request(app).post(`/api/voice-identities/${identityId}/voice-profiles`).send({
      batchId,
      candidateId: 2,
      profileName: '官方讲解员 V1',
      profileVersion: 'V1.0',
      usageBoundaries: { allowed: ['产品介绍'], forbidden: ['误导性内容'] },
    }).expect(201);
    expect(frozen.body.profile.status).toBe('published');
    expect(frozen.body.profile.manifestHash).toMatch(/^[a-f0-9]{64}$/);

    const profileDirectory = path.join(directory, 'voice-profiles', identityId, 'V1.0');
    const manifest = JSON.parse(await fs.readFile(path.join(profileDirectory, 'manifest.json'), 'utf8'));
    expect(manifest.referenceCandidate).toBe('#002');
    expect(manifest.designBatch.id).toBe(batchId);
    await expect(fs.readFile(path.join(profileDirectory, 'manifest.sha256'), 'utf8')).resolves.toContain('manifest.json');

    await request(app).post(`/api/voice-identities/${identityId}/voice-profiles`).send({
      batchId,
      candidateId: 2,
      profileName: '官方讲解员 V1',
      profileVersion: 'V1.0',
    }).expect(409);
  });
});
