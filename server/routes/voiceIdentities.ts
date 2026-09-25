import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { getConfig } from '../config';
import { fail } from './respond';

export const voiceIdentitiesRouter = Router();

export const VOICE_SOURCES = ['AI 原创设计', '授权真人克隆', 'Provider 预置音色', '导入已有 Voice Profile'] as const;
const OWNER_TYPES = ['企业', '品牌', '产品', '栏目 / IP', 'Agent', '虚拟角色', '个人', '活动', '客户项目'] as const;
const LANGUAGES = ['中文（普通话）', '英文', '中英双语'] as const;
const VISIBILITIES = ['仅自己可见', '团队内可见', '组织内可见'] as const;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

type VoiceSource = typeof VOICE_SOURCES[number];
type Identity = {
  id: string;
  name: string;
  ownerDescription: string;
  ownerType: string;
  ownerName: string;
  ownerGroup: string;
  description: string;
  source: VoiceSource;
  language: string;
  version: string;
  status: '草稿' | '评审中' | '已发布' | '已退役';
  license: string;
  visibility: string;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
};

type SourceConfig = { source: VoiceSource; configuration: Record<string, unknown>; updatedAt: string };

const identityRoot = () => path.join(getConfig().libraryDir, 'voice-identities');
const identityDirectory = (id: string) => path.join(identityRoot(), id);
const identityPath = (id: string) => path.join(identityDirectory(id), 'identity.json');
const sourceConfigPath = (id: string) => path.join(identityDirectory(id), 'source-config.json');

function safeId(res: Parameters<typeof fail>[0], id: string) {
  if (SAFE_ID.test(id)) return true;
  fail(res, 400, '声音角色 ID 格式无效。', 'invalid_identity_id');
  return false;
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

function asText(value: unknown, fallback = '', maxLength = 800) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function ownerGroup(ownerType: string) {
  if (ownerType === '产品') return '产品';
  if (ownerType === '栏目 / IP') return '栏目 / IP';
  if (ownerType === '个人') return '个人 / 讲师';
  return '企业 / 品牌';
}

function licenseFor(source: VoiceSource) {
  if (source === '授权真人克隆') return '待授权';
  if (source === 'Provider 预置音色') return 'Provider 许可';
  if (source === '导入已有 Voice Profile') return '待校验';
  return '不适用';
}

function makeIdentity(body: Record<string, unknown>, existing?: Identity): Identity {
  const now = new Date().toISOString();
  const ownerType = isOneOf(body.ownerType, OWNER_TYPES) ? body.ownerType : existing?.ownerType || '品牌';
  const ownerName = asText(body.ownerName ?? body.owner, existing?.ownerName || 'Semovix', 120);
  const roleName = asText(body.roleName, existing?.name === '未命名声音角色' ? '' : existing?.name || '', 120);
  const source = isOneOf(body.source, VOICE_SOURCES) ? body.source : existing?.source || 'AI 原创设计';
  const language = isOneOf(body.language, LANGUAGES) ? body.language : existing?.language || '中文（普通话）';
  const description = asText(body.description, existing?.description || '', 1000);
  const visibility = isOneOf(body.visibility, VISIBILITIES) ? body.visibility : existing?.visibility || '团队内可见';
  const name = roleName || '未命名声音角色';
  return {
    id: existing?.id || `voice-${crypto.randomUUID()}`,
    name,
    ownerDescription: asText(body.ownerDescription, existing?.ownerDescription || `${ownerName || '未选择归属对象'}的声音身份`, 280),
    ownerType,
    ownerName,
    ownerGroup: ownerGroup(ownerType),
    description: description || '用途说明待完善。',
    source,
    language: language === '中文（普通话）' ? '中文' : language,
    version: existing?.version || '尚未冻结',
    status: existing?.status || '草稿',
    license: existing?.source === source ? existing.license : licenseFor(source),
    visibility,
    mine: true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

async function readIdentity(id: string): Promise<Identity | null> {
  try { return JSON.parse(await fs.readFile(identityPath(id), 'utf8')) as Identity; }
  catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temp, file);
}

async function listIdentities(): Promise<Identity[]> {
  try {
    const entries = await fs.readdir(identityRoot(), { withFileTypes: true });
    const identities = await Promise.all(entries.filter(entry => entry.isDirectory() && SAFE_ID.test(entry.name)).map(entry => readIdentity(entry.name)));
    return identities.filter((identity): identity is Identity => Boolean(identity)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

voiceIdentitiesRouter.get('/voice-identities', async (_req, res) => {
  try { res.json({ identities: await listIdentities() }); }
  catch (error: any) { fail(res, 500, error?.message || '读取声音角色失败。', 'identity_list_failed'); }
});

voiceIdentitiesRouter.post('/voice-identities', async (req, res) => {
  try {
    const identity = makeIdentity(req.body || {});
    await writeJson(identityPath(identity.id), identity);
    res.status(201).json({ identity });
  } catch (error: any) { fail(res, 500, error?.message || '创建声音角色失败。', 'identity_create_failed'); }
});

voiceIdentitiesRouter.get('/voice-identities/:id', async (req, res) => {
  if (!safeId(res, req.params.id)) return;
  try {
    const identity = await readIdentity(req.params.id);
    if (!identity) return fail(res, 404, '声音角色不存在。', 'identity_not_found');
    res.json({ identity });
  } catch (error: any) { fail(res, 500, error?.message || '读取声音角色失败。', 'identity_read_failed'); }
});

voiceIdentitiesRouter.patch('/voice-identities/:id', async (req, res) => {
  if (!safeId(res, req.params.id)) return;
  try {
    const existing = await readIdentity(req.params.id);
    if (!existing) return fail(res, 404, '声音角色不存在。', 'identity_not_found');
    const identity = makeIdentity(req.body || {}, existing);
    await writeJson(identityPath(identity.id), identity);
    res.json({ identity });
  } catch (error: any) { fail(res, 500, error?.message || '更新声音角色失败。', 'identity_update_failed'); }
});

voiceIdentitiesRouter.get('/voice-identities/:id/source-config', async (req, res) => {
  if (!safeId(res, req.params.id)) return;
  try {
    const identity = await readIdentity(req.params.id);
    if (!identity) return fail(res, 404, '声音角色不存在。', 'identity_not_found');
    try { res.json({ config: JSON.parse(await fs.readFile(sourceConfigPath(req.params.id), 'utf8')) as SourceConfig }); }
    catch (error: any) { if (error?.code === 'ENOENT') res.json({ config: null }); else throw error; }
  } catch (error: any) { fail(res, 500, error?.message || '读取声音来源配置失败。', 'source_config_read_failed'); }
});

voiceIdentitiesRouter.put('/voice-identities/:id/source-config', async (req, res) => {
  if (!safeId(res, req.params.id)) return;
  try {
    const identity = await readIdentity(req.params.id);
    if (!identity) return fail(res, 404, '声音角色不存在。', 'identity_not_found');
    const source = req.body?.source;
    const configuration = req.body?.configuration;
    if (!isOneOf(source, VOICE_SOURCES) || !configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
      return fail(res, 400, '声音来源类型或来源配置无效。', 'invalid_source_config');
    }
    if (source !== identity.source) return fail(res, 409, '来源配置与声音角色创建方式不一致。', 'source_mismatch');
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(configuration), 'utf8'); }
    catch { return fail(res, 400, '声音来源配置必须是可序列化对象。', 'invalid_source_config'); }
    if (size > 128 * 1024) return fail(res, 413, '声音来源配置超过 128 KB 限制。', 'source_config_too_large');
    const config: SourceConfig = { source, configuration, updatedAt: new Date().toISOString() };
    await writeJson(sourceConfigPath(req.params.id), config);
    res.json({ config });
  } catch (error: any) { fail(res, 500, error?.message || '保存声音来源配置失败。', 'source_config_write_failed'); }
});
