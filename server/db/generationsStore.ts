/**
 * generations 生成记录持久化（可追溯性地基，迁移 0002）
 * 成功与失败的引擎调用都留痕；失败行不带输出文件但有 error 描述。
 */
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { getDb } from './libraryStore';

export interface GenerationRecord {
  id: string;
  kind: 'tts' | 'asr';
  engine: string;
  model?: string | null;
  voice?: string | null;
  params?: Record<string, unknown> | null;
  input_text?: string | null;
  item_id?: string | null;
  output_file?: string | null;
  duration_sec?: number | null;
  sample_rate?: number | null;
  status: 'done' | 'failed';
  error?: string | null;
  created_at?: string;
}

export function artifactsDir(): string {
  const dir = path.join(getConfig().libraryDir, 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 写生成输出音频文件（artifacts/<id>.wav），返回文件名 */
export function writeArtifactFile(id: string, data: Buffer): { fileName: string; size: number } {
  const fileName = `${id}.wav`;
  fs.writeFileSync(path.join(artifactsDir(), fileName), data);
  return { fileName, size: data.length };
}

export function readArtifactFile(id: string): { filePath: string } | null {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return null;
  const filePath = path.join(artifactsDir(), `${id}.wav`);
  if (!fs.existsSync(filePath)) return null;
  return { filePath };
}

const rowToRecord = (row: any): GenerationRecord & { params?: Record<string, unknown> | null; created_at: string } => ({
  ...row,
  params: row.params ? JSON.parse(row.params) : null,
});

export function recordGeneration(rec: GenerationRecord): void {
  getDb().prepare(`
    INSERT INTO generations (id, kind, engine, model, voice, params, input_text, item_id,
                             output_file, duration_sec, sample_rate, status, error, created_at)
    VALUES (@id, @kind, @engine, @model, @voice, @params, @input_text, @item_id,
            @output_file, @duration_sec, @sample_rate, @status, @error, @created_at)
  `).run({
    id: rec.id,
    kind: rec.kind,
    engine: rec.engine,
    model: rec.model ?? null,
    voice: rec.voice ?? null,
    params: rec.params ? JSON.stringify(rec.params) : null,
    input_text: rec.input_text ?? null,
    item_id: rec.item_id ?? null,
    output_file: rec.output_file ?? null,
    duration_sec: rec.duration_sec ?? null,
    sample_rate: rec.sample_rate ?? null,
    status: rec.status,
    error: rec.error ?? null,
    created_at: rec.created_at ?? new Date().toISOString(),
  });
}

export function listGenerations(opts: { itemId?: string; limit?: number } = {}): (GenerationRecord & { params?: Record<string, unknown> | null; created_at: string })[] {
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 500);
  const rows = opts.itemId
    ? getDb().prepare('SELECT * FROM generations WHERE item_id = ? ORDER BY created_at DESC LIMIT ?').all(opts.itemId, limit)
    : getDb().prepare('SELECT * FROM generations ORDER BY created_at DESC LIMIT ?').all(limit);
  return (rows as any[]).map(rowToRecord);
}
