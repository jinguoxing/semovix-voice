/**
 * 0004 声音角色元数据：角色与来源配置进入 SQLite；WAV、授权文件和不可变
 * 批次证据仍留在受控角色目录中。payload_json 保留完整领域对象，列用于查询与索引。
 */
import type { Migration } from '../migrations';

export const voiceIdentities: Migration = {
  version: '0004',
  name: 'voice identity metadata',
  up: db => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_identities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        source TEXT NOT NULL,
        language TEXT NOT NULL,
        status TEXT NOT NULL,
        visibility TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_voice_identities_updated_at ON voice_identities(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_voice_identities_source_status ON voice_identities(source, status);

      CREATE TABLE IF NOT EXISTS voice_identity_source_configs (
        identity_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        configuration_json TEXT NOT NULL,
        FOREIGN KEY(identity_id) REFERENCES voice_identities(id) ON DELETE CASCADE
      );
    `);
  },
};
