/**
 * Library API (素材库：SQLite 元数据 + 磁盘文件)
 * （自 server.ts 原样迁移）
 */
import { Router } from 'express';
import multer from 'multer';
import {
  listItems, getItem, saveItem, updateItem, deleteItem,
  writeItemFile, readItemFile,
  listFolders, saveFolder, deleteFolder, replaceFolders,
} from '../db/libraryStore';
import { fail } from './respond';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

export const libraryRouter = Router();

libraryRouter.get('/library/items', (_req, res) => {
  res.json({ items: listItems() });
});

/**
 * 新建/覆盖素材。P4 起音频走 multipart 文件上传（硬性约束 #7）：
 *   multipart/form-data：字段 item（JSON 字符串）+ 文件 audio（可选，仅改元数据时不带）
 */
libraryRouter.post('/library/items', upload.single('audio'), (req, res) => {
  try {
    if (req.body?.audioBase64) {
      return fail(res, 400, 'JSON Base64 传输已停用：请以 multipart/form-data 上传音频文件（字段名 audio）。', 'unsupported_transport');
    }
    const rawItem = req.body?.item;
    const item = typeof rawItem === 'string' ? JSON.parse(rawItem) : rawItem;
    if (!item || !item.id) {
      return fail(res, 400, 'item (含 id) is required.', 'invalid_request');
    }

    let payload = { ...item };
    if (req.file && req.file.buffer.length > 0) {
      writeItemFile(String(item.id), item.format || 'wav', req.file.buffer);
      payload = { ...payload, fileSize: req.file.buffer.length };
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

/**
 * 覆盖素材音频文件（P01 数据完整性：编辑器“覆盖原素材”必须真正写服务端文件）。
 * multipart/form-data：文件字段 audio；query 可带 duration/sampleRate/channels 同步元数据。
 */
libraryRouter.put('/library/items/:id/audio', upload.single('audio'), (req, res) => {
  try {
    const existing = getItem(req.params.id);
    if (!existing) return fail(res, 404, 'Item not found.', 'not_found');
    if (!req.file || req.file.buffer.length === 0) {
      return fail(res, 400, 'Audio file is required (multipart/form-data, field "audio").', 'invalid_request');
    }
    writeItemFile(req.params.id, existing.format || 'wav', req.file.buffer);
    const metaUpdates: Record<string, unknown> = { fileSize: req.file.buffer.length };
    const duration = Number(req.query.duration);
    const sampleRate = Number(req.query.sampleRate);
    const channels = Number(req.query.channels);
    if (Number.isFinite(duration) && duration > 0) metaUpdates.duration = duration;
    if (Number.isFinite(sampleRate) && sampleRate > 0) metaUpdates.sampleRate = sampleRate;
    if (Number.isFinite(channels) && channels > 0) metaUpdates.channels = channels;
    const updated = updateItem(req.params.id, metaUpdates);
    res.json({ item: updated, fileSize: req.file.buffer.length });
  } catch (error: any) {
    console.error('Library audio overwrite error:', error);
    res.status(500).json({ error: error.message || 'Failed to overwrite audio file.' });
  }
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
