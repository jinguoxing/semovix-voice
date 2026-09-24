/**
 * 0003 素材完整性列：sha256 / mimeType / verifiedAt（P01 音频原子写入）。
 * - sha256：写入文件时计算的内容哈希（防篡改/防错配）
 * - mimeType：上传时声明的 MIME 类型（回放 Content-Type 的权威来源）
 * - verifiedAt：最近一次「写文件 + 元数据落库」原子完成的时刻
 * 幂等：已存在同名列的库（部分手工加过）跳过对应 ALTER。
 */
import type { Migration } from '../migrations';

function columns(db: import('better-sqlite3').Database): Set<string> {
  const rows = db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>;
  return new Set(rows.map(r => r.name));
}

export const assetIntegrity: Migration = {
  version: '0003',
  name: 'asset integrity columns',
  up: db => {
    const cols = columns(db);
    if (!cols.has('sha256')) db.exec('ALTER TABLE items ADD COLUMN sha256 TEXT');
    if (!cols.has('mimeType')) db.exec('ALTER TABLE items ADD COLUMN mimeType TEXT');
    if (!cols.has('verifiedAt')) db.exec('ALTER TABLE items ADD COLUMN verifiedAt TEXT');
  },
};
