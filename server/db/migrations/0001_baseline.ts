/**
 * 0001 基线：素材库 items / folders 表（自原 libraryStore.ts 的 DDL 原样迁移）。
 * 使用 IF NOT EXISTS 以兼容迁移框架引入前已存在的库。
 */
import type { Migration } from '../migrations';

export const baseline: Migration = {
  version: '0001',
  name: 'baseline items/folders',
  up: db => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        duration REAL,
        sampleRate INTEGER,
        channels INTEGER,
        format TEXT,
        fileSize INTEGER,
        createdAt TEXT,
        updatedAt TEXT,
        tags TEXT,          -- JSON string[]
        rating INTEGER,
        folderId TEXT,
        transcript TEXT,
        waveformData TEXT,  -- JSON number[]
        metadata TEXT,      -- JSON object
        fileName TEXT
      );
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        createdAt TEXT
      );
    `);
  },
};
