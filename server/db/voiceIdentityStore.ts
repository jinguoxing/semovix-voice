/**
 * 声音角色的关系型元数据索引。
 *
 * 媒体、授权文件、批次和 Profile 仍使用角色目录承载不可变证据；本模块只保存
 * 可查询的角色和来源配置元数据。JSON 快照由路由层维护，便于离线检查与旧版本兼容。
 */
import { getDb } from './libraryStore';

export type StoredVoiceIdentity = {
  id: string;
  name: string;
  ownerType: string;
  ownerName: string;
  source: string;
  language: string;
  status: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type StoredSourceConfig = {
  source: string;
  configuration: Record<string, unknown>;
  updatedAt: string;
};

type IdentityRow = { payload_json: string };
type ConfigRow = { source: string; configuration_json: string; updated_at: string };

function parse<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; }
  catch { return null; }
}

export function readVoiceIdentity(id: string): StoredVoiceIdentity | null {
  const row = getDb().prepare('SELECT payload_json FROM voice_identities WHERE id = ?').get(id) as IdentityRow | undefined;
  return row ? parse<StoredVoiceIdentity>(row.payload_json) : null;
}

export function listVoiceIdentities(): StoredVoiceIdentity[] {
  const rows = getDb().prepare('SELECT payload_json FROM voice_identities ORDER BY updated_at DESC').all() as IdentityRow[];
  return rows.map(row => parse<StoredVoiceIdentity>(row.payload_json)).filter((row): row is StoredVoiceIdentity => Boolean(row));
}

export function saveVoiceIdentity(identity: StoredVoiceIdentity): void {
  getDb().prepare(`
    INSERT INTO voice_identities (id, name, owner_type, owner_name, source, language, status, visibility, created_at, updated_at, payload_json)
    VALUES (@id, @name, @ownerType, @ownerName, @source, @language, @status, @visibility, @createdAt, @updatedAt, @payload)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, owner_type=excluded.owner_type, owner_name=excluded.owner_name,
      source=excluded.source, language=excluded.language, status=excluded.status,
      visibility=excluded.visibility, updated_at=excluded.updated_at, payload_json=excluded.payload_json
  `).run({
    id: identity.id,
    name: identity.name,
    ownerType: identity.ownerType,
    ownerName: identity.ownerName,
    source: identity.source,
    language: identity.language,
    status: identity.status,
    visibility: identity.visibility,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    payload: JSON.stringify(identity),
  });
}

export function readVoiceIdentitySourceConfig(identityId: string): StoredSourceConfig | null {
  const row = getDb().prepare('SELECT source, configuration_json, updated_at FROM voice_identity_source_configs WHERE identity_id = ?').get(identityId) as ConfigRow | undefined;
  if (!row) return null;
  const configuration = parse<Record<string, unknown>>(row.configuration_json);
  return configuration ? { source: row.source, configuration, updatedAt: row.updated_at } : null;
}

export function saveVoiceIdentitySourceConfig(identityId: string, config: StoredSourceConfig): void {
  getDb().prepare(`
    INSERT INTO voice_identity_source_configs (identity_id, source, updated_at, configuration_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(identity_id) DO UPDATE SET source=excluded.source, updated_at=excluded.updated_at, configuration_json=excluded.configuration_json
  `).run(identityId, config.source, config.updatedAt, JSON.stringify(config.configuration));
}
