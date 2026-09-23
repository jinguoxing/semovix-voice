/**
 * AudioCraft Studio - Server-side Library Store
 * 音频文件落磁盘 (library/files/)，元数据存 SQLite (library/library.db)
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LIBRARY_ROOT = path.resolve(__dirname, 'library');
export const FILES_DIR = path.join(LIBRARY_ROOT, 'files');
const DB_PATH = path.join(LIBRARY_ROOT, 'library.db');

fs.mkdirSync(FILES_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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
  return (db.prepare('SELECT * FROM items ORDER BY createdAt DESC').all() as LibraryItemRow[]).map(rowToItem);
}

export function getItem(id: string): any | null {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as LibraryItemRow | undefined;
  return row ? rowToItem(row) : null;
}

function itemFileName(id: string, format: string): string {
  const ext = (format || 'wav').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'wav';
  return `${id}.${ext}`;
}

export function saveItem(item: any): any {
  assertSafeId(String(item.id));
  const fileName = itemFileName(item.id, item.format);
  db.prepare(`
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
  const row = db.prepare('SELECT fileName FROM items WHERE id = ?').get(id) as { fileName?: string } | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  const filePath = path.join(FILES_DIR, row.fileName || itemFileName(id, 'wav'));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return true;
}

export function writeItemFile(id: string, format: string, data: Buffer): { fileName: string; size: number } {
  assertSafeId(id);
  const fileName = itemFileName(id, format);
  fs.writeFileSync(path.join(FILES_DIR, fileName), data);
  return { fileName, size: data.length };
}

export function readItemFile(id: string): { filePath: string; fileName: string } | null {
  assertSafeId(id);
  const row = db.prepare('SELECT fileName FROM items WHERE id = ?').get(id) as { fileName?: string } | undefined;
  if (!row?.fileName) return null;
  const filePath = path.join(FILES_DIR, row.fileName);
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
  return db.prepare('SELECT * FROM folders ORDER BY createdAt ASC').all() as any[];
}

function seedFoldersIfEmpty(): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM folders').get() as { c: number }).c;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO folders (id, name, color, createdAt) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  for (const f of DEFAULT_FOLDERS) insert.run(f.id, f.name, f.color, now);
}

export function saveFolder(folder: { id: string; name: string; color?: string; createdAt?: string }): any {
  assertSafeId(folder.id);
  db.prepare(`
    INSERT INTO folders (id, name, color, createdAt) VALUES (@id, @name, @color, @createdAt)
    ON CONFLICT(id) DO UPDATE SET name=@name, color=@color
  `).run({
    id: folder.id,
    name: folder.name,
    color: folder.color ?? '#6366f1',
    createdAt: folder.createdAt ?? new Date().toISOString(),
  });
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(folder.id);
}

export function deleteFolder(id: string): void {
  assertSafeId(id);
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  // 素材保留，归入未分类
  db.prepare('UPDATE items SET folderId = NULL WHERE folderId = ?').run(id);
}

export function replaceFolders(folders: any[]): any[] {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM folders').run();
    for (const f of folders) saveFolder(f);
  });
  tx();
  return listFolders();
}
