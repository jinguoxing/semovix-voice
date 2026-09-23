/**
 * 素材库 API 集成测试：CRUD、文件落盘、文件夹。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestEnv, cleanupTestEnv, tinyWavBase64 } from './helpers';

let app: Express;
let libraryDir: string;

beforeAll(async () => {
  const env = await setupTestEnv();
  app = env.createApp();
  libraryDir = env.libraryDir;
});

afterAll(() => cleanupTestEnv(libraryDir));

describe('POST /api/library/items', () => {
  it('persists metadata and writes the audio file to disk', async () => {
    const res = await request(app)
      .post('/api/library/items')
      .send({
        item: {
          id: 'it-speech-1',
          title: '测试旁白',
          category: 'speech',
          duration: 0.01,
          sampleRate: 24000,
          channels: 1,
          format: 'wav',
          tags: ['测试'],
          createdAt: new Date().toISOString(),
        },
        audioBase64: tinyWavBase64(),
      })
      .expect(200);

    expect(res.body.item.id).toBe('it-speech-1');
    expect(res.body.item.audioUrl).toBe('/api/library/file/it-speech-1');

    const file = path.join(libraryDir, 'files', 'it-speech-1.wav');
    expect(fs.existsSync(file)).toBe(true);
    const stat = fs.statSync(file);
    expect(res.body.item.fileSize).toBe(stat.size);
    expect(stat.size).toBeGreaterThan(44);
  });

  it('rejects items without id', async () => {
    const res = await request(app)
      .post('/api/library/items')
      .send({ item: { title: 'no id' } })
      .expect(400);
    expect(res.body.error).toMatch(/id/);
  });

  it('rejects unsafe ids (path traversal)', async () => {
    await request(app)
      .post('/api/library/items')
      .send({ item: { id: '../evil', title: 'x' } })
      .expect(500); // assertSafeId 抛错 → 500；不落盘即核心约束
    expect(fs.existsSync(path.join(libraryDir, 'files', '../evil.wav'))).toBe(false);
  });
});

describe('GET /api/library/items & file', () => {
  it('lists items and serves audio bytes with wav mime', async () => {
    await request(app)
      .post('/api/library/items')
      .send({
        item: { id: 'it-speech-2', title: '第二段', format: 'wav' },
        audioBase64: tinyWavBase64(),
      });

    const list = await request(app).get('/api/library/items').expect(200);
    expect(list.body.items.some((i: any) => i.id === 'it-speech-2')).toBe(true);

    const file = await request(app).get('/api/library/file/it-speech-2').expect(200);
    expect(file.headers['content-type']).toBe('audio/wav');
    const body = file.body as Buffer;
    expect(body.length).toBeGreaterThan(44);
    expect(body.toString('ascii', 0, 4)).toBe('RIFF');
  });

  it('404s for unknown file ids', async () => {
    await request(app).get('/api/library/file/nope').expect(404);
  });
});

describe('PATCH & DELETE /api/library/items/:id', () => {
  it('updates metadata and deletes row + file', async () => {
    await request(app)
      .post('/api/library/items')
      .send({
        item: { id: 'it-del-1', title: '待删除', format: 'wav' },
        audioBase64: tinyWavBase64(),
      });

    const patched = await request(app)
      .patch('/api/library/items/it-del-1')
      .send({ rating: 5, description: '升级' })
      .expect(200);
    expect(patched.body.item.rating).toBe(5);
    expect(patched.body.item.description).toBe('升级');

    await request(app).delete('/api/library/items/it-del-1').expect(200);
    expect(fs.existsSync(path.join(libraryDir, 'files', 'it-del-1.wav'))).toBe(false);
    await request(app).get('/api/library/file/it-del-1').expect(404);
  });
});

describe('folders', () => {
  it('seeds defaults on empty db, supports create & safe delete', async () => {
    const seeded = await request(app).get('/api/library/folders').expect(200);
    expect(seeded.body.folders.length).toBeGreaterThanOrEqual(4);
    expect(seeded.body.folders.some((f: any) => f.id === 'f-podcast')).toBe(true);

    await request(app)
      .post('/api/library/folders')
      .send({ id: 'f-test', name: '品牌旁白', color: '#123456' })
      .expect(200);

    // 文件夹删除后素材保留、归入未分类
    await request(app)
      .post('/api/library/items')
      .send({
        item: { id: 'it-folder-1', title: '带文件夹', folderId: 'f-test', format: 'wav' },
        audioBase64: tinyWavBase64(),
      });
    await request(app).delete('/api/library/folders/f-test').expect(200);

    const after = await request(app).get('/api/library/items').expect(200);
    const item = after.body.items.find((i: any) => i.id === 'it-folder-1');
    expect(item).toBeTruthy();
    expect(item.folderId).toBeUndefined();
  });
});
