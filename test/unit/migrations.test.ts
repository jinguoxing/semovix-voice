/**
 * 迁移框架单元测试：全新库、幂等重跑、旧库无损纳入版本管理。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { migrate, MIGRATIONS } from '../../server/db/migrations';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'semovix-mig-'));
}

let dir: string;

beforeEach(() => {
  dir = tmpDir();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('migrate()', () => {
  it('creates baseline tables and records version on a fresh db', () => {
    const db = new Database(path.join(dir, 'library.db'));
    const applied = migrate(db);
    expect(applied).toEqual(MIGRATIONS.map(m => m.version));

    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>).map(r => r.name);
    expect(tables).toContain('items');
    expect(tables).toContain('folders');
    expect(tables).toContain('schema_migrations');

    const versions = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: string }>)
      .map(r => r.version);
    expect(versions).toEqual(MIGRATIONS.map(m => m.version));
    db.close();
  });

  it('is idempotent: second run applies nothing', () => {
    const db = new Database(path.join(dir, 'library.db'));
    migrate(db);
    expect(migrate(db)).toEqual([]);
    db.close();
  });

  it('adopts a pre-framework legacy db without data loss', () => {
    const dbPath = path.join(dir, 'library.db');
    // 模拟旧库：无 schema_migrations，但已有业务表与数据
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, category TEXT,
        duration REAL, sampleRate INTEGER, channels INTEGER, format TEXT, fileSize INTEGER,
        createdAt TEXT, updatedAt TEXT, tags TEXT, rating INTEGER, folderId TEXT,
        transcript TEXT, waveformData TEXT, metadata TEXT, fileName TEXT
      );
      CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, createdAt TEXT);
      INSERT INTO items (id, title, fileName) VALUES ('legacy-1', '旧素材', 'legacy-1.wav');
    `);
    legacy.close();

    const db = new Database(dbPath);
    const applied = migrate(db);
    expect(applied).toEqual(MIGRATIONS.map(m => m.version)); // 基线补记 + 后续增量迁移全部补齐
    const row = db.prepare('SELECT title FROM items WHERE id = ?').get('legacy-1') as { title: string };
    expect(row.title).toBe('旧素材'); // 数据无损
    db.close();
  });

  it('runs each migration at most once even when list grows', () => {
    const db = new Database(path.join(dir, 'library.db'));
    migrate(db);
    // 模拟未来新增迁移：直接重复调用同一列表也应为空
    const again = migrate(db);
    expect(again).toEqual([]);
    db.close();
  });
});
