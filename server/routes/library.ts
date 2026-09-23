/**
 * Library API (素材库：SQLite 元数据 + 磁盘文件)
 * （自 server.ts 原样迁移）
 */
import { Router } from 'express';
import {
  listItems, getItem, saveItem, updateItem, deleteItem,
  writeItemFile, readItemFile,
  listFolders, saveFolder, deleteFolder, replaceFolders,
} from '../db/libraryStore';

export const libraryRouter = Router();

libraryRouter.get('/library/items', (_req, res) => {
  res.json({ items: listItems() });
});

/**
 * 新建/覆盖素材。body: { item, audioBase64? }
 * audioBase64 带 data: 前缀亦可（data:audio/wav;base64,....）
 */
libraryRouter.post('/library/items', (req, res) => {
  try {
    const { item, audioBase64 } = req.body || {};
    if (!item || !item.id) {
      return res.status(400).json({ error: 'item (含 id) is required.' });
    }

    let payload = { ...item };
    if (audioBase64) {
      const clean = String(audioBase64).replace(/^data:audio\/[a-z0-9]+;base64,/, '');
      const buf = Buffer.from(clean, 'base64');
      writeItemFile(String(item.id), item.format || 'wav', buf);
      payload = { ...payload, fileSize: buf.length };
    }

    const saved = saveItem(payload);
    res.json({ item: saved });
  } catch (error: any) {
    console.error('Library save error:', error);
    res.status(500).json({ error: error.message || 'Failed to save item.' });
  }
});

/** 部分更新素材元数据 */
libraryRouter.patch('/library/items/:id', (req, res) => {
  const updated = updateItem(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Item not found.' });
  res.json({ item: updated });
});

/** 删除单个素材（含磁盘文件） */
libraryRouter.delete('/library/items/:id', (req, res) => {
  const ok = deleteItem(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Item not found.' });
  res.json({ items: listItems() });
});

/** 批量删除 */
libraryRouter.post('/library/items/batch-delete', (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  for (const id of ids) deleteItem(id);
  res.json({ items: listItems() });
});

/** 批量移动到文件夹（folderId 为 null/undefined = 未分类） */
libraryRouter.post('/library/move', (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const folderId = req.body?.folderId ?? null;
  for (const id of ids) updateItem(id, { folderId });
  res.json({ items: listItems() });
});

/** 批量追加标签 */
libraryRouter.post('/library/tags', (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const newTags: string[] = Array.isArray(req.body?.tags) ? req.body.tags : [];
  for (const id of ids) {
    const current = getItem(id);
    if (!current) continue;
    const merged = Array.from(new Set([...(current.tags || []), ...newTags]));
    updateItem(id, { tags: merged });
  }
  res.json({ items: listItems() });
});

/** 素材音频文件（res.sendFile 自带 Range 分段播放支持） */
libraryRouter.get('/library/file/:id', (req, res) => {
  const file = readItemFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'Audio file not found.' });
  const mime = file.fileName.endsWith('.wav') ? 'audio/wav'
    : file.fileName.endsWith('.mp3') ? 'audio/mpeg'
    : file.fileName.endsWith('.webm') ? 'audio/webm'
    : file.fileName.endsWith('.ogg') ? 'audio/ogg'
    : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.sendFile(file.filePath);
});

/** 列出文件夹（空库自动播种默认文件夹） */
libraryRouter.get('/library/folders', (_req, res) => {
  res.json({ folders: listFolders() });
});

/** 新建/更新文件夹 */
libraryRouter.post('/library/folders', (req, res) => {
  try {
    const { id, name, color, createdAt } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id and name are required.' });
    const folder = saveFolder({ id, name, color, createdAt });
    res.json({ folder, folders: listFolders() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save folder.' });
  }
});

/** 整表替换文件夹（迁移用） */
libraryRouter.post('/library/folders/replace', (req, res) => {
  try {
    const folders = Array.isArray(req.body?.folders) ? req.body.folders : [];
    res.json({ folders: replaceFolders(folders) });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to replace folders.' });
  }
});

/** 删除文件夹（素材保留并归入未分类） */
libraryRouter.delete('/library/folders/:id', (req, res) => {
  deleteFolder(req.params.id);
  res.json({ folders: listFolders() });
});
