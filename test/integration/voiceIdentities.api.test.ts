import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTestEnv, setupTestEnv, type TestEnv } from './helpers';

let env: TestEnv | null = null;
afterEach(() => { if (env) cleanupTestEnv(env.libraryDir); env = null; });

describe('voice identities API', () => {
  it('persists a draft identity and its source configuration', async () => {
    env = await setupTestEnv();
    const app = env.createApp();
    const created = await request(app).post('/api/voice-identities').send({
      roleName: '产品讲解员', ownerType: '品牌', ownerName: '示例品牌',
      language: '中文（普通话）', source: 'AI 原创设计', description: '用于产品讲解。', visibility: '团队内可见',
    }).expect(201);
    const identity = created.body.identity;
    expect(identity.id).toMatch(/^voice-/);
    expect(identity.name).toBe('产品讲解员');
    expect(identity.license).toBe('不适用');

    await request(app).put(`/api/voice-identities/${identity.id}/source-config`).send({
      source: 'AI 原创设计', configuration: { brief: '专业、清晰。', activeBatchId: '20260924-01' },
    }).expect(200);

    const listed = await request(app).get('/api/voice-identities').expect(200);
    expect(listed.body.identities).toHaveLength(1);
    const source = await request(app).get(`/api/voice-identities/${identity.id}/source-config`).expect(200);
    expect(source.body.config.configuration.activeBatchId).toBe('20260924-01');
    await expect(fs.readFile(path.join(env.libraryDir, 'voice-identities', identity.id, 'identity.json'), 'utf8')).resolves.toContain('产品讲解员');
    const db = new Database(path.join(env.libraryDir, 'library.db'), { readonly: true });
    expect(db.prepare('SELECT name FROM voice_identities WHERE id = ?').get(identity.id)).toEqual({ name: '产品讲解员' });
    expect(db.prepare('SELECT source FROM voice_identity_source_configs WHERE identity_id = ?').get(identity.id)).toEqual({ source: 'AI 原创设计' });
    db.close();
  });

  it('accepts incomplete drafts but rejects a source type mismatch', async () => {
    env = await setupTestEnv();
    const app = env.createApp();
    const created = await request(app).post('/api/voice-identities').send({}).expect(201);
    expect(created.body.identity.name).toBe('未命名声音角色');
    await request(app).put(`/api/voice-identities/${created.body.identity.id}/source-config`).send({
      source: '授权真人克隆', configuration: { referenceText: '示例文本' },
    }).expect(409);
  });
});
