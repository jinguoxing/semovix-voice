import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { getConfig } from '../config';

export const voiceLifecycleRouter = Router();

type ReviewRecord = {
  identityId: string;
  batchId: string;
  finalists: number[];
  eliminated: number[];
  vetoes: Record<string, string[]>;
  scores: Record<string, number[]>;
  note: string;
  tags: string[];
  reviewedAt: string;
};

type ValidationRecord = {
  identityId: string;
  batchId: string;
  candidateId: number;
  profileName: string;
  profileVersion: string;
  savedAt: string;
};

const identityIdIsSafe = (value: string) => /^[A-Za-z0-9_-]{1,120}$/.test(value);
const batchIdIsSafe = (value: string) => /^\d{8}-\d{2,}$/.test(value);
const versionIsSafe = (value: string) => /^V\d+\.\d+(?:\.\d+)?$/.test(value);

const batchDirectory = (batchId: string) => path.join(getConfig().libraryDir, 'voice-design-batches', batchId);
const reviewPath = (batchId: string) => path.join(batchDirectory(batchId), 'review.json');
const validationPath = (batchId: string) => path.join(batchDirectory(batchId), 'validation.json');

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch { return null; }
}

async function writeJson(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2));
  await fs.rename(temporary, file);
}

async function getBatch(batchId: string) {
  if (!batchIdIsSafe(batchId)) return null;
  return readJson<{ id: string; status: string; totalCount: number; snapshot: { identityId: string; identityName: string; model: string; language: string; reference: string } }>(path.join(batchDirectory(batchId), 'batch.json'));
}

function reviewFrom(input: unknown, identityId: string, batchId: string): ReviewRecord | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as Record<string, unknown>;
  const finalists = body.finalists;
  const eliminated = body.eliminated;
  const vetoes = body.vetoes;
  const scores = body.scores;
  const note = body.note;
  const tags = body.tags;
  if (!Array.isArray(finalists) || finalists.length < 1 || finalists.length > 3 || !finalists.every(value => Number.isInteger(value) && Number(value) > 0)) return null;
  if (new Set(finalists).size !== finalists.length || !Array.isArray(eliminated) || !eliminated.every(value => Number.isInteger(value) && Number(value) > 0)) return null;
  if (!vetoes || typeof vetoes !== 'object' || !scores || typeof scores !== 'object' || typeof note !== 'string' || note.length > 300 || !Array.isArray(tags) || !tags.every(value => typeof value === 'string')) return null;
  const vetoMap = vetoes as Record<string, unknown>;
  const scoreMap = scores as Record<string, unknown>;
  if (!Object.values(vetoMap).every(value => Array.isArray(value) && value.every(item => typeof item === 'string'))) return null;
  if (!Object.values(scoreMap).every(value => Array.isArray(value) && value.length === 7 && value.every(item => Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 5))) return null;
  if (finalists.some(candidateId => (vetoMap[String(candidateId)] as string[] | undefined)?.length)) return null;
  return { identityId, batchId, finalists, eliminated, vetoes: vetoMap as Record<string, string[]>, scores: scoreMap as Record<string, number[]>, note, tags, reviewedAt: new Date().toISOString() };
}

voiceLifecycleRouter.get('/voice-design/batches/:batchId/review', async (req, res) => {
  const batch = await getBatch(req.params.batchId);
  if (!batch) return res.status(404).json({ error: '声音设计批次不存在', code: 'not_found' });
  return res.json({ review: await readJson<ReviewRecord>(reviewPath(req.params.batchId)) });
});

voiceLifecycleRouter.put('/voice-design/batches/:batchId/review', async (req, res) => {
  const batch = await getBatch(req.params.batchId);
  const identityId = typeof req.body?.identityId === 'string' ? req.body.identityId : '';
  if (!batch || !identityIdIsSafe(identityId) || batch.snapshot.identityId !== identityId) return res.status(404).json({ error: '声音设计批次不存在或不属于当前声音角色', code: 'not_found' });
  if (batch.status !== 'completed') return res.status(409).json({ error: '候选尚未全部生成完成，不能开始匿名评审', code: 'batch_incomplete' });
  const review = reviewFrom(req.body, identityId, req.params.batchId);
  if (!review) return res.status(400).json({ error: '匿名评审记录不完整或包含不可入围候选', code: 'invalid_review' });
  const candidateCount = batch.totalCount;
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || review.finalists.some(candidateId => candidateId > candidateCount) || review.eliminated.some(candidateId => candidateId > candidateCount) || Array.from({ length: candidateCount }, (_, index) => index + 1).some(candidateId => !review.scores[String(candidateId)])) return res.status(400).json({ error: '候选编号无效或仍有候选未完成评分', code: 'invalid_candidate' });
  await writeJson(reviewPath(req.params.batchId), review);
  return res.json({ review });
});

voiceLifecycleRouter.put('/voice-design/batches/:batchId/validation', async (req, res) => {
  const batch = await getBatch(req.params.batchId);
  const identityId = typeof req.body?.identityId === 'string' ? req.body.identityId : '';
  const candidateId = Number(req.body?.candidateId);
  const profileName = typeof req.body?.profileName === 'string' ? req.body.profileName.trim() : '';
  const profileVersion = typeof req.body?.profileVersion === 'string' ? req.body.profileVersion.trim() : '';
  const review = await readJson<ReviewRecord>(reviewPath(req.params.batchId));
  if (!batch || !review || !identityIdIsSafe(identityId) || batch.snapshot.identityId !== identityId) return res.status(404).json({ error: '未找到可验证的声音设计批次', code: 'not_found' });
  if (!Number.isInteger(candidateId) || !review.finalists.includes(candidateId) || !profileName || !versionIsSafe(profileVersion)) return res.status(400).json({ error: '验证结果或拟发布候选无效', code: 'invalid_validation' });
  const validation: ValidationRecord = { identityId, batchId: req.params.batchId, candidateId, profileName, profileVersion, savedAt: new Date().toISOString() };
  await writeJson(validationPath(req.params.batchId), validation);
  return res.json({ validation });
});

voiceLifecycleRouter.post('/voice-identities/:identityId/voice-profiles', async (req, res) => {
  const identityId = req.params.identityId;
  const batchId = typeof req.body?.batchId === 'string' ? req.body.batchId : '';
  const batch = await getBatch(batchId);
  const validation = await readJson<ValidationRecord>(validationPath(batchId));
  const review = await readJson<ReviewRecord>(reviewPath(batchId));
  if (!identityIdIsSafe(identityId) || !batch || !validation || !review || batch.snapshot.identityId !== identityId || validation.identityId !== identityId) return res.status(409).json({ error: '请先完成匿名评审并保存验证结果', code: 'lifecycle_incomplete' });
  const candidateId = Number(req.body?.candidateId);
  if (!Number.isInteger(candidateId) || candidateId !== validation.candidateId || !review.finalists.includes(candidateId)) return res.status(400).json({ error: '拟发布候选未通过验证', code: 'invalid_candidate' });
  const profileName = typeof req.body?.profileName === 'string' ? req.body.profileName.trim() : '';
  const version = typeof req.body?.profileVersion === 'string' ? req.body.profileVersion.trim() : '';
  if (!profileName || !versionIsSafe(version)) return res.status(400).json({ error: 'Profile 名称或版本号无效', code: 'invalid_profile' });
  const parent = path.join(getConfig().libraryDir, 'voice-profiles', identityId);
  const directory = path.join(parent, version);
  try { await fs.mkdir(parent, { recursive: true }); await fs.mkdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return res.status(409).json({ error: `Voice Profile ${version} 已存在，不能覆盖已冻结版本`, code: 'version_exists' }); throw error; }
  const manifest = {
    schemaVersion: 1,
    identity: { id: identityId, name: batch.snapshot.identityName, sourceType: 'AI_DESIGNED' },
    version,
    profileName,
    frozenAt: new Date().toISOString(),
    referenceCandidate: `#${String(candidateId).padStart(3, '0')}`,
    productionModel: 'Qwen3-TTS-12Hz-1.7B-Base',
    language: batch.snapshot.language,
    referenceText: batch.snapshot.reference,
    designBatch: { id: batchId, model: batch.snapshot.model },
    review: { finalists: review.finalists, reviewedAt: review.reviewedAt },
    validation: { savedAt: validation.savedAt, candidateId: validation.candidateId },
    usageBoundaries: req.body?.usageBoundaries || null,
  };
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  try {
    await fs.writeFile(path.join(directory, 'manifest.json'), content, { flag: 'wx' });
    await fs.writeFile(path.join(directory, 'manifest.sha256'), `${hash}  manifest.json\n`, { flag: 'wx' });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
  return res.status(201).json({ profile: { identityId, profileName, version, status: 'published', manifestHash: hash, frozenAt: manifest.frozenAt } });
});
