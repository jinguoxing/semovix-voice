/**
 * Semovix Voice Studio - 素材库持久化
 * 音频文件落磁盘 (<libraryDir>/files/)，元数据存 SQLite (<libraryDir>/library.db)。
 * 表结构由版本化迁移（server/db/migrations.ts）管理。
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { migrate } from './migrations';

export function libraryDirs(): { root: string; files: string; dbPath: string } {
  const root = getConfig().libraryDir;
  return { root, files: path.join(root, 'files'), dbPath: path.join(root, 'library.db') };
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const { files, dbPath } = libraryDirs();
  fs.mkdirSync(files, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

export interface LibraryItemRow {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  duration?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  format?: string | null;
  fileSize?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: string | null;
  rating?: number | null;
  folderId?: string | null;
  transcript?: string | null;
  waveformData?: string | null;
  metadata?: string | null;
  fileName?: string | null;
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error(`非法素材 ID: ${id}`);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToItem(row: LibraryItemRow): any {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category ?? undefined,
    duration: row.duration ?? 0,
    sampleRate: row.sampleRate ?? 24000,
    channels: row.channels ?? 1,
    format: row.format ?? 'wav',
    fileSize: row.fileSize ?? 0,
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? undefined,
    tags: parseJson<string[]>(row.tags, []),
    rating: row.rating ?? 3,
    folderId: row.folderId ?? undefined,
    transcript: row.transcript ?? undefined,
    waveformData: parseJson<number[]>(row.waveformData, []),
    metadata: parseJson<Record<string, any>>(row.metadata, {}),
    audioUrl: `/api/library/file/${row.id}`,
  };
}

/* ---------------- Items ---------------- */

export function listItems(): any[] {
  return (getDb().prepare('SELECT * FROM items ORDER BY createdAt DESC').all() as LibraryItemRow[]).map(rowToItem);
}

export function getItem(id: string): any | null {
  const row = getDb().prepare('SELECT * FROM items WHERE id = ?').get(id) as LibraryItemRow | undefined;
  return row ? rowToItem(row) : null;
}

function itemFileName(id: string, format: string): string {
  const ext = (format || 'wav').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'wav';
  return `${id}.${ext}`;
}

export function saveItem(item: any): any {
  assertSafeId(String(item.id));
  const fileName = itemFileName(item.id, item.format);
  getDb().prepare(`
    INSERT INTO items (id, title, description, category, duration, sampleRate, channels, format,
                       fileSize, createdAt, updatedAt, tags, rating, folderId, transcript,
                       waveformData, metadata, fileName)
    VALUES (@id, @title, @description, @category, @duration, @sampleRate, @channels, @format,
            @fileSize, @createdAt, @updatedAt, @tags, @rating, @folderId, @transcript,
            @waveformData, @metadata, @fileName)
    ON CONFLICT(id) DO UPDATE SET
      title=@title, description=@description, category=@category, duration=@duration,
      sampleRate=@sampleRate, channels=@channels, format=@format, fileSize=@fileSize,
      updatedAt=@updatedAt, tags=@tags, rating=@rating, folderId=@folderId,
      transcript=@transcript, waveformData=@waveformData, metadata=@metadata, fileName=@fileName
  `).run({
    id: String(item.id),
    title: item.title ?? '未命名素材',
    description: item.description ?? null,
    category: item.category ?? null,
    duration: item.duration ?? 0,
    sampleRate: item.sampleRate ?? 24000,
    channels: item.channels ?? 1,
    format: item.format ?? 'wav',
    fileSize: item.fileSize ?? 0,
    createdAt: item.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: JSON.stringify(item.tags ?? []),
    rating: item.rating ?? 3,
    folderId: item.folderId ?? null,
    transcript: item.transcript ?? null,
    waveformData: JSON.stringify(item.waveformData ?? []),
    metadata: JSON.stringify(item.metadata ?? {}),
    fileName,
  });
  return getItem(String(item.id));
}

export function updateItem(id: string, updates: Record<string, any>): any | null {
  const current = getItem(id);
  if (!current) return null;
  const merged = { ...current, ...updates, id, audioUrl: undefined };
  return saveItem(merged);
}

export function deleteItem(id: string): boolean {
  assertSafeId(id);
  const row = getDb().prepare('SELECT fileName FROM items WHERE id = ?').get(id) as { fileName?: string } | undefined;
  if (!row) return false;
  getDb().prepare('DELETE FROM items WHERE id = ?').run(id);
  const filePath = path.join(libraryDirs().files, row.fileName || itemFileName(id, 'wav'));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return true;
}

export function writeItemFile(id: string, format: string, data: Buffer): { fileName: string; size: number } {
  assertSafeId(id);
  getDb(); // 确保目录与迁移已就绪（修复：全新库上首个写文件请求先于任何读请求时 files/ 不存在）
  const fileName = itemFileName(id, format);
  fs.writeFileSync(path.join(libraryDirs().files, fileName), data);
  return { fileName, size: data.length };
}

export function readItemFile(id: string): { filePath: string; fileName: string } | null {
  assertSafeId(id);
  const row = getDb().prepare('SELECT fileName FROM items WHERE id = ?').get(id) as { fileName?: string } | undefined;
  if (!row?.fileName) return null;
  const filePath = path.join(libraryDirs().files, row.fileName);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, fileName: row.fileName };
}

/* ---------------- Folders ---------------- */

const DEFAULT_FOLDERS = [
  { id: 'f-podcast', name: '播客与配音集', color: '#38bdf8' },
  { id: 'f-gamesfx', name: '游戏与科幻音效', color: '#a855f7' },
  { id: 'f-lofibgm', name: 'Lo-Fi 旋律采样', color: '#34d399' },
  { id: 'f-ambient', name: '自然白噪音与环境', color: '#fbbf24' },
];

export function listFolders(): any[] {
  seedFoldersIfEmpty();
  return getDb().prepare('SELECT * FROM folders ORDER BY createdAt ASC').all() as any[];
}

function seedFoldersIfEmpty(): void {
  const count = (getDb().prepare('SELECT COUNT(*) AS c FROM folders').get() as { c: number }).c;
  if (count > 0) return;
  const insert = getDb().prepare('INSERT INTO folders (id, name, color, createdAt) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  for (const f of DEFAULT_FOLDERS) insert.run(f.id, f.name, f.color, now);
}

export function saveFolder(folder: { id: string; name: string; color?: string; createdAt?: string }): any {
  assertSafeId(folder.id);
  getDb().prepare(`
    INSERT INTO folders (id, name, color, createdAt) VALUES (@id, @name, @color, @createdAt)
    ON CONFLICT(id) DO UPDATE SET name=@name, color=@color
  `).run({
    id: folder.id,
    name: folder.name,
    color: folder.color ?? '#6366f1',
    createdAt: folder.createdAt ?? new Date().toISOString(),
  });
  return getDb().prepare('SELECT * FROM folders WHERE id = ?').get(folder.id);
}

export function deleteFolder(id: string): void {
  assertSafeId(id);
  getDb().prepare('DELETE FROM folders WHERE id = ?').run(id);
  // 素材保留，归入未分类
  getDb().prepare('UPDATE items SET folderId = NULL WHERE folderId = ?').run(id);
}

export function replaceFolders(folders: any[]): any[] {
  const tx = getDb().transaction(() => {
    getDb().prepare('DELETE FROM folders').run();
    for (const f of folders) saveFolder(f);
  });
  tx();
  return listFolders();
}
