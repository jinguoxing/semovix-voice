/**
 * 生成记录与输出工件（可追溯性）
 * - GET /api/generations?itemId=&limit=  生成留痕（含失败记录）
 * - GET /api/artifacts/:id               生成输出 WAV（sendFile 支持 Range）
 */
import { Router } from 'express';
import { listGenerations, readArtifactFile } from '../db/generationsStore';
import { fail } from './respond';

export const generationsRouter = Router();

generationsRouter.get('/generations', (req, res) => {
  const itemId = typeof req.query.itemId === 'string' && req.query.itemId ? req.query.itemId : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) || 50 : 50;
  res.json({ generations: listGenerations({ itemId, limit }) });
});

generationsRouter.get('/artifacts/:id', (req, res) => {
  const file = readArtifactFile(req.params.id);
  if (!file) return fail(res, 404, 'Artifact not found.', 'not_found');
  res.setHeader('Content-Type', 'audio/wav');
  res.sendFile(file.filePath);
});
