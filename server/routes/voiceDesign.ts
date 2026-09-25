import { createHash, randomInt } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { getConfig } from '../config';
import { qwenWorkerVoiceDesign, waitForWorkerEngineReady } from '../engines/qwenWorker';
import { extractPcm16, wavDuration } from '../audio/wav';

export const voiceDesignRouter = Router();
const MODEL = 'Qwen3-TTS-12Hz-1.7B-VoiceDesign';

type Direction = { id: string; name: string; description: string; features: string[] };
type Snapshot = {
  identityId: string;
  identityName: string;
  brief: string;
  reference: string;
  forbidden: string[];
  directions: Direction[];
  candidatesPerDirection: number;
  language: '中文（普通话）' | '英文' | '中英双语';
  fixedSeed: boolean;
  seed: string;
  model: string;
  outputFormat: 'WAV';
};
type Candidate = {
  id: string;
  directionId: string;
  seed: number;
  reviewId?: number;
  duration?: number;
  peaks?: number[];
  sha256?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  file?: string;
  error?: string;
};
type Batch = {
  id: string;
  label: string;
  status: 'queued' | 'warming' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  completedCount: number;
  totalCount: number;
  snapshot: Snapshot;
  candidates: Candidate[];
  error?: string;
};

const batchRoot = () => path.join(getConfig().libraryDir, 'voice-design-batches');
const manifestPath = (id: string) => path.join(batchRoot(), id, 'batch.json');
const validId = (id: string) => /^\d{8}-\d{2,}$/.test(id);
let queue: Promise<void> = Promise.resolve();

async function runtimeStatus() {
  try {
    const response = await fetch(`${getConfig().workerUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { engines?: { voice_design?: { state?: string; error?: string | null } } };
    const voiceDesign = body.engines?.voice_design;
    return { reachable: true, supported: Boolean(voiceDesign), state: voiceDesign?.state || 'unavailable', error: voiceDesign?.error || null };
  } catch {
    return { reachable: false, supported: false, state: 'unavailable', error: '本地 Worker 不可达' };
  }
}

async function writeBatch(batch: Batch) {
  batch.updatedAt = new Date().toISOString();
  const file = manifestPath(batch.id);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(batch, null, 2));
  await fs.rename(tmp, file);
}

async function readBatch(id: string): Promise<Batch | null> {
  if (!validId(id)) return null;
  try { return JSON.parse(await fs.readFile(manifestPath(id), 'utf8')) as Batch; }
  catch { return null; }
}

function validate(body: unknown): Snapshot | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const directions = raw.directions;
  if (typeof raw.identityId !== 'string' || !raw.identityId.trim() || typeof raw.identityName !== 'string' || !raw.identityName.trim()) return null;
  if (typeof raw.brief !== 'string' || !raw.brief.trim() || raw.brief.length > 800 || typeof raw.reference !== 'string' || !raw.reference.trim()) return null;
  if (!Array.isArray(directions) || directions.length < 2 || directions.length > 4) return null;
  if (!directions.every(item => item && typeof item.id === 'string' && /^[A-D]$/.test(item.id) && typeof item.name === 'string' && item.name.trim() && typeof item.description === 'string' && item.description.trim() && Array.isArray(item.features))) return null;
  if (!Number.isInteger(raw.candidatesPerDirection) || Number(raw.candidatesPerDirection) < 1 || Number(raw.candidatesPerDirection) > 6) return null;
  if (!['中文（普通话）', '英文', '中英双语'].includes(String(raw.language))) return null;
  if (!Array.isArray(raw.forbidden) || !raw.forbidden.every(item => typeof item === 'string')) return null;
  const fixedSeed = raw.fixedSeed === true;
  if (fixedSeed && (!/^\d{1,10}$/.test(String(raw.seed)) || Number(raw.seed) > 2147483647)) return null;
  return {
    identityId: raw.identityId.trim(), identityName: raw.identityName.trim(), brief: raw.brief.trim(), reference: raw.reference.trim(),
    forbidden: raw.forbidden as string[], directions: directions as Direction[], candidatesPerDirection: Number(raw.candidatesPerDirection),
    language: raw.language as Snapshot['language'], fixedSeed, seed: fixedSeed ? String(raw.seed) : '', model: MODEL, outputFormat: 'WAV',
  };
}

async function allocateBatch(snapshot: Snapshot): Promise<Batch> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  await fs.mkdir(batchRoot(), { recursive: true });
  let id = '';
  for (let number = 1; number < 10000; number++) {
    const candidate = `${date}-${String(number).padStart(2, '0')}`;
    try { await fs.mkdir(path.join(batchRoot(), candidate)); id = candidate; break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  if (!id) throw new Error('无法分配声音设计批次编号');
  const candidates: Candidate[] = snapshot.directions.flatMap((direction, directionIndex) => Array.from({ length: snapshot.candidatesPerDirection }, (_, index) => ({
    id: `${direction.id}-${String(index + 1).padStart(2, '0')}`,
    directionId: direction.id,
    seed: snapshot.fixedSeed ? Number(snapshot.seed) + directionIndex * snapshot.candidatesPerDirection + index : randomInt(1, 2147483647),
    status: 'pending' as const,
  })));
  const anonymousIds = candidates.map((_, index) => index + 1);
  for (let index = anonymousIds.length - 1; index > 0; index--) {
    const swap = randomInt(0, index + 1);
    [anonymousIds[index], anonymousIds[swap]] = [anonymousIds[swap], anonymousIds[index]];
  }
  candidates.forEach((candidate, index) => { candidate.reviewId = anonymousIds[index]; });
  const now = new Date().toISOString();
  const batch: Batch = { id, label: `Batch ${id}`, status: 'queued', createdAt: now, updatedAt: now, completedCount: 0, totalCount: candidates.length, snapshot, candidates };
  await writeBatch(batch);
  return batch;
}

async function runBatch(batch: Batch) {
  try {
    batch.status = 'warming'; await writeBatch(batch);
    await waitForWorkerEngineReady('voice_design', { timeoutMs: 600_000, pollIntervalMs: 2_000 });
    batch.status = 'running'; await writeBatch(batch);
    for (const candidate of batch.candidates) {
      candidate.status = 'running'; await writeBatch(batch);
      const direction = batch.snapshot.directions.find(item => item.id === candidate.directionId)!;
      const instruct = [batch.snapshot.brief, `设计方向“${direction.name}”：${direction.description}`, direction.features.length ? `关键特征：${direction.features.join('、')}。` : '', batch.snapshot.forbidden.length ? `避免以下风格：${batch.snapshot.forbidden.join('、')}。` : ''].filter(Boolean).join('\n');
      const language = batch.snapshot.language === '英文' ? 'English' : batch.snapshot.language === '中英双语' ? 'Auto' : 'Chinese';
      try {
        const wav = await qwenWorkerVoiceDesign({ text: batch.snapshot.reference, instruct, language, seed: candidate.seed });
        const filename = `${candidate.id}.wav`;
        await fs.writeFile(path.join(batchRoot(), batch.id, filename), wav);
        candidate.file = filename;
        candidate.duration = wavDuration(wav);
        candidate.peaks = waveformPeaks(wav);
        candidate.sha256 = createHash('sha256').update(wav).digest('hex');
        candidate.status = 'completed';
        batch.completedCount += 1;
      } catch (error) {
        candidate.status = 'failed';
        candidate.error = error instanceof Error ? error.message : String(error);
        batch.status = 'failed';
        batch.error = `候选 ${candidate.id} 生成失败：${candidate.error}`;
        await writeBatch(batch);
        return;
      }
      await writeBatch(batch);
    }
    batch.status = 'completed'; await writeBatch(batch);
  } catch (error) {
    batch.status = 'failed';
    batch.error = error instanceof Error ? error.message : String(error);
    await writeBatch(batch);
  }
}

function waveformPeaks(wav: Buffer, bucketCount = 32) {
  try {
    const { pcm } = extractPcm16(wav);
    const samples = Math.floor(pcm.length / 2);
    if (!samples) return [];
    return Array.from({ length: bucketCount }, (_, bucket) => {
      const start = Math.floor(samples * bucket / bucketCount);
      const end = Math.max(start + 1, Math.floor(samples * (bucket + 1) / bucketCount));
      let peak = 0;
      for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(index * 2)));
      return Math.round(peak / 32767 * 1000) / 1000;
    });
  } catch {
    return [];
  }
}

function publicBatch(batch: Batch) {
  return {
    id: batch.id,
    label: batch.label,
    status: batch.status,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    completedCount: batch.completedCount,
    totalCount: batch.totalCount,
    error: batch.error,
    snapshot: {
      identityId: batch.snapshot.identityId,
      identityName: batch.snapshot.identityName,
      language: batch.snapshot.language,
      model: batch.snapshot.model,
      outputFormat: batch.snapshot.outputFormat,
    },
    candidates: batch.candidates.map(candidate => ({ id: candidate.id, status: candidate.status, error: candidate.error })),
  };
}

voiceDesignRouter.get('/voice-design/status', async (_req, res) => {
  res.json({ model: MODEL, ...(await runtimeStatus()) });
});

voiceDesignRouter.post('/voice-design/batches', async (req, res) => {
  const snapshot = validate(req.body);
  if (!snapshot) return res.status(400).json({ error: '声音设计配置不完整或无效', code: 'invalid_design' });
  const runtime = await runtimeStatus();
  if (!runtime.supported) return res.status(503).json({ error: runtime.reachable ? '当前 Worker 尚未加载 VoiceDesign 接口，请重启 Worker 后重试。' : '本地 Worker 不可达，请启动 Worker 后重试。', code: 'voice_design_unavailable' });
  try {
    const batch = await allocateBatch(snapshot);
    queue = queue.then(() => runBatch(batch)).catch(error => { console.error('VoiceDesign batch queue:', error); });
    return res.status(202).json(publicBatch(batch));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : '批次创建失败', code: 'batch_create_failed' });
  }
});

voiceDesignRouter.get('/voice-design/batches/:id', async (req, res) => {
  const batch = await readBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: '声音设计批次不存在', code: 'not_found' });
  return res.json(publicBatch(batch));
});

voiceDesignRouter.get('/voice-design/batches/:id/review-candidates', async (req, res) => {
  const batch = await readBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: '声音设计批次不存在', code: 'not_found' });
  if (batch.status !== 'completed') return res.status(409).json({ error: '候选尚未全部生成完成，不能进入匿名评审', code: 'batch_incomplete' });
  const candidates = batch.candidates
    .filter(candidate => candidate.status === 'completed' && candidate.file)
    .map((candidate, index) => ({ id: candidate.reviewId || index + 1, duration: candidate.duration || 0, peaks: candidate.peaks || [] }));
  if (candidates.length !== batch.totalCount || new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) {
    return res.status(409).json({ error: '候选批次记录不完整，无法开始匿名评审', code: 'batch_candidates_incomplete' });
  }
  return res.json({
    batch: { id: batch.id, label: batch.label, totalCount: batch.totalCount, language: batch.snapshot.language },
    reference: batch.snapshot.reference,
    candidates,
  });
});

voiceDesignRouter.get('/voice-design/batches/:id/review-candidates/:reviewId/audio', async (req, res) => {
  const batch = await readBatch(req.params.id);
  const reviewId = Number(req.params.reviewId);
  if (!batch || !Number.isInteger(reviewId) || reviewId < 1) return res.status(404).json({ error: '匿名候选不存在', code: 'not_found' });
  const candidate = batch.candidates.find(item => (item.reviewId || 0) === reviewId && item.status === 'completed' && item.file);
  if (!candidate?.file) return res.status(404).json({ error: '候选音频尚未生成', code: 'not_found' });
  res.setHeader('Content-Type', 'audio/wav');
  return res.sendFile(path.join(batchRoot(), batch.id, candidate.file));
});

voiceDesignRouter.get('/voice-design/batches/:id/candidates/:candidateId/audio', async (req, res) => {
  const batch = await readBatch(req.params.id);
  const candidate = batch?.candidates.find(item => item.id === req.params.candidateId && item.status === 'completed' && item.file);
  if (!candidate?.file) return res.status(404).json({ error: '候选音频尚未生成', code: 'not_found' });
  return res.sendFile(path.join(batchRoot(), batch!.id, candidate.file));
});
