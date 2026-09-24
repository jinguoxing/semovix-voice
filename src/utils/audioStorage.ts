/**
 * AudioCraft Studio - Library API Client
 * 素材与文件夹的真正持久化在服务端（SQLite + 磁盘文件），
 * 本模块负责调 /api/library/* 并做一次性的 localStorage/IndexedDB 旧数据迁移。
 */

import { AudioItem, AudioFolder } from '../types/audio';
import { renderSoundRecipe, renderBeatPattern } from './audioEngine';

/* ---------------- 旧版存储键（迁移源） ---------------- */
const LEGACY_KEY_ITEMS = 'audiocraft_items_meta';
const LEGACY_KEY_FOLDERS = 'audiocraft_folders';
const LEGACY_DB_NAME = 'AudioCraftStudioDB';
const LEGACY_STORE_NAME = 'audio_files';
const MIGRATION_FLAG = 'audiocraft_server_migration_v1';

/* ---------------- API helpers ---------------- */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/library${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Library API ${path} 失败 (HTTP ${res.status}) ${detail.slice(0, 120)}`);
  }
  return res.json() as Promise<T>;
}


/** 解码音频并计算真实波形峰值（0-1） */
export async function extractPeaks(blob: Blob, count = 48): Promise<number[]> {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = audio.getChannelData(0);
    const bucket = Math.max(1, Math.floor(data.length / count));
    const peaks: number[] = [];
    for (let i = 0; i < count; i++) {
      let max = 0;
      const start = i * bucket;
      const end = Math.min(data.length, start + bucket);
      for (let j = start; j < end; j += 4) { // 每 4 个采样抽 1 个，速度足够
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      peaks.push(Math.round(max * 100) / 100);
    }
    ctx.close();
    return peaks;
  } catch (e) {
    console.warn('extractPeaks failed, using placeholder', e);
    return Array.from({ length: count }, (_, i) => 0.3 + 0.4 * Math.abs(Math.sin(i * 0.5)));
  }
}

/* ---------------- Items ---------------- */

/**
 * 上传素材：data: URL 或 Blob → 服务端文件；返回带服务端 audioUrl 的素材。
 * P4 起走 multipart/form-data（硬性约束 #7：大音频不得 JSON Base64 传输）。
 */
export async function addAudioItem(item: AudioItem, blob?: Blob): Promise<AudioItem> {
  let payloadBlob = blob;
  if (!payloadBlob && item.audioUrl?.startsWith('data:')) {
    payloadBlob = await (await fetch(item.audioUrl)).blob();
  }

  const form = new FormData();
  form.append('item', JSON.stringify(item));
  if (payloadBlob) {
    form.append('audio', payloadBlob, `${item.id}.${item.format || 'wav'}`);
  }

  const res = await fetch('/api/library/items', { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Library API /items 失败 (HTTP ${res.status}) ${detail.slice(0, 120)}`);
  }
  const { item: saved } = await res.json() as { item: AudioItem };
  return saved;
}

export async function getAudioItems(): Promise<AudioItem[]> {
  try {
    await migrateLegacyDataIfNeeded();
    const { items } = await api<{ items: AudioItem[] }>('/items');
    if (items.length === 0) {
      return await seedStarterAudio();
    }
    return items;
  } catch (e) {
    console.error('加载素材库失败（服务端不可用？）', e);
    return [];
  }
}

/** 部分更新素材元数据。服务端 PATCH 契约返回 { item }（单对象）。 */
export async function updateAudioItem(id: string, updates: Partial<AudioItem>): Promise<AudioItem> {
  const { item } = await api<{ item: AudioItem }>(`/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return item;
}

/**
 * 覆盖素材的服务端音频文件（P01 数据完整性）：multipart PUT。
 * audio 元数据（duration/sampleRate/channels）经 query 同步，返回更新后的 item。
 */
export async function overwriteAudioFile(
  id: string,
  blob: Blob,
  meta: { duration?: number; sampleRate?: number; channels?: number } = {},
): Promise<AudioItem> {
  const form = new FormData();
  form.append('audio', blob, `${id}.wav`);

  const qs = new URLSearchParams();
  if (meta.duration && meta.duration > 0) qs.set('duration', String(meta.duration));
  if (meta.sampleRate && meta.sampleRate > 0) qs.set('sampleRate', String(meta.sampleRate));
  if (meta.channels && meta.channels > 0) qs.set('channels', String(meta.channels));

  const res = await fetch(`/api/library/items/${encodeURIComponent(id)}/audio?${qs.toString()}`, {
    method: 'PUT',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`覆盖音频文件失败 (HTTP ${res.status}) ${detail.slice(0, 120)}`);
  }
  const { item } = await res.json() as { item: AudioItem };
  return item;
}

export async function deleteAudioItem(id: string): Promise<AudioItem[]> {
  const { items } = await api<{ items: AudioItem[] }>(`/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return items;
}

export async function deleteMultipleAudioItems(ids: string[]): Promise<AudioItem[]> {
  const { items } = await api<{ items: AudioItem[] }>('/items/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  return items;
}

export async function moveAudioToFolder(ids: string[], folderId?: string): Promise<AudioItem[]> {
  const { items } = await api<{ items: AudioItem[] }>('/move', {
    method: 'POST',
    body: JSON.stringify({ ids, folderId: folderId ?? null }),
  });
  return items;
}

export async function batchAddTags(ids: string[], newTags: string[]): Promise<AudioItem[]> {
  const { items } = await api<{ items: AudioItem[] }>('/tags', {
    method: 'POST',
    body: JSON.stringify({ ids, tags: newTags }),
  });
  return items;
}

/* ---------------- Folders ---------------- */

export async function getFolders(): Promise<AudioFolder[]> {
  try {
    const { folders } = await api<{ folders: AudioFolder[] }>('/folders');
    return folders;
  } catch (e) {
    console.error('加载文件夹失败（服务端不可用？）', e);
    return [];
  }
}

export async function createFolder(name: string, color = '#6366f1'): Promise<AudioFolder> {
  const { folder, folders } = await api<{ folder: AudioFolder; folders: AudioFolder[] }>('/folders', {
    method: 'POST',
    body: JSON.stringify({ id: `f-${Date.now()}`, name, color, createdAt: new Date().toISOString() }),
  });
  void folders;
  return folder;
}

export async function deleteFolder(folderId: string): Promise<AudioFolder[]> {
  const { folders } = await api<{ folders: AudioFolder[] }>(`/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
  });
  return folders;
}

/** 工程导入用：整表替换文件夹 */
export async function restoreFolders(folders: AudioFolder[]): Promise<AudioFolder[]> {
  const { folders: saved } = await api<{ folders: AudioFolder[] }>('/folders/replace', {
    method: 'POST',
    body: JSON.stringify({ folders }),
  });
  return saved;
}

/* ---------------- 一次性迁移：localStorage/IndexedDB → 服务端 ---------------- */

/** 迁移失败阶段（P01 数据完整性：任何阶段的失败都阻断旧数据清理） */
export type LegacyMigrationStage =
  | 'folders-parse'    // 旧文件夹 JSON 损坏
  | 'folders-upload'   // /folders/replace 上传失败
  | 'item-read'        // 旧素材元数据损坏 / IndexedDB 不可用 / 音频数据缺失
  | 'item-upload'      // 单条素材上传服务端失败
  | 'verify'           // 服务端复验：素材缺失或文件夹数量减少
  | 'idb'              // 旧 IndexedDB 库删除失败/被阻塞
  | 'unexpected';      // 未预期异常（安全网）

export interface LegacyMigrationFailure {
  stage: LegacyMigrationStage;
  /** 涉及的素材/文件夹 ID（如有） */
  id?: string;
  error: string;
}

export interface LegacyMigrationResult {
  /** true = 全部迁移成功（或本无旧数据）且旧数据已清理 */
  migrated: boolean;
  migratedItems: number;
  failures: LegacyMigrationFailure[];
}

function legacyOpenDB(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined' || !indexedDB?.open) return resolve(null);
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function legacyGetBlob(db: IDBDatabase, id: string): Promise<Blob | null> {
  return new Promise(resolve => {
    const tx = db.transaction(LEGACY_STORE_NAME, 'readonly');
    const req = tx.objectStore(LEGACY_STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => resolve(null);
  });
}

/**
 * 删除旧 IndexedDB 库（Promise 化，含 onblocked）：
 * 有旧标签页占用连接时 onblocked 触发 → 返回 false，不设迁移标记，下次重试。
 */
function deleteLegacyDatabase(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined' || !indexedDB?.deleteDatabase) return resolve(true);
    try {
      // IDBOpenDBRequest 的 onblocked 事件签名与库版本冲突，此处按赋值回调使用（宽松类型）
      const req = indexedDB.deleteDatabase(LEGACY_DB_NAME) as any;
      if (!req || !('onsuccess' in req)) return resolve(true); // 非标准实现（测试桩等）：视为已删除
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * 一次性迁移：localStorage/IndexedDB → 服务端（P01 事务化）。
 *
 * 阶段：folders-parse → folders-upload → item-read → item-upload → verify → 清理。
 * - 服务端复验：GET /items + /folders，所有旧素材 ID 必须存在、文件夹数量不得减少；
 * - 仅当 failures.length === 0 才清理（localStorage → IndexedDB → 迁移标记）；
 * - 任何失败保留旧数据与未设置标记，下次加载重试（addAudioItem 为 upsert，幂等）。
 */
export async function migrateLegacyDataIfNeeded(): Promise<LegacyMigrationResult> {
  if (localStorage.getItem(MIGRATION_FLAG)) {
    return { migrated: true, migratedItems: 0, failures: [] };
  }

  const failures: LegacyMigrationFailure[] = [];
  let migratedItems = 0;

  try {
    const rawItems = localStorage.getItem(LEGACY_KEY_ITEMS);
    const rawFolders = localStorage.getItem(LEGACY_KEY_FOLDERS);

    // 1) 文件夹：整表搬到服务端（服务端空库会播种默认文件夹，这里覆盖为用户实际有的）
    let folders: AudioFolder[] = [];
    if (rawFolders) {
      try {
        const parsed = JSON.parse(rawFolders);
        if (Array.isArray(parsed)) folders = parsed;
        else failures.push({ stage: 'folders-parse', error: '旧文件夹数据不是数组' });
      } catch (e) {
        failures.push({ stage: 'folders-parse', error: `旧文件夹 JSON 损坏: ${(e as Error)?.message || e}` });
      }
      if (folders.length) {
        try {
          await api('/folders/replace', { method: 'POST', body: JSON.stringify({ folders }) });
        } catch (e) {
          failures.push({ stage: 'folders-upload', error: `文件夹上传服务端失败: ${(e as Error)?.message || e}` });
        }
      }
    }

    // 2) 素材：meta + IndexedDB blob / data: URL → 服务端文件
    let items: AudioItem[] = [];
    if (rawItems) {
      try {
        const parsed = JSON.parse(rawItems);
        if (Array.isArray(parsed)) items = parsed;
        else failures.push({ stage: 'item-read', error: '旧素材元数据不是数组' });
      } catch (e) {
        failures.push({ stage: 'item-read', error: `旧素材元数据 JSON 损坏: ${(e as Error)?.message || e}` });
      }

      let db: IDBDatabase | null = null;
      try {
        db = await legacyOpenDB();
      } catch (e) {
        console.warn('IndexedDB 打开失败，仅迁移 data: URL 形式的旧素材', e);
      }

      for (const item of items) {
        try {
          let blob: Blob | null = null;
          if (item.audioUrl?.startsWith('data:')) {
            blob = await (await fetch(item.audioUrl)).blob();
          } else if (db) {
            blob = await legacyGetBlob(db, item.id);
          }
          if (!blob) {
            failures.push({ stage: 'item-read', id: item.id, error: '找不到音频数据（无 data: URL 且 IndexedDB 无此 blob）' });
            continue;
          }
          await addAudioItem({ ...item, audioUrl: '' }, blob);
          migratedItems++;
        } catch (e) {
          failures.push({ stage: 'item-upload', id: item.id, error: `上传服务端失败: ${(e as Error)?.message || e}` });
        }
      }
      db?.close();
    }

    if (migratedItems > 0) {
      console.log(`[迁移] ${migratedItems} 条旧素材已搬入服务端素材库`);
    }

    // 3) 服务端复验（存在旧数据时）：所有旧素材 ID 都在服务端；文件夹数量没有减少
    if ((items.length > 0 || folders.length > 0) && failures.length === 0) {
      try {
        const [{ items: serverItems }, { folders: serverFolders }] = await Promise.all([
          api<{ items: AudioItem[] }>('/items'),
          api<{ folders: AudioFolder[] }>('/folders'),
        ]);
        const serverIds = new Set(serverItems.map(i => i.id));
        for (const item of items) {
          if (!serverIds.has(item.id)) {
            failures.push({ stage: 'verify', id: item.id, error: '服务端复验时该素材缺失' });
          }
        }
        if (folders.length && serverFolders.length < folders.length) {
          failures.push({
            stage: 'verify',
            error: `服务端文件夹数量减少（旧 ${folders.length} → 服务端 ${serverFolders.length}）`,
          });
        }
      } catch (e) {
        failures.push({ stage: 'verify', error: `服务端复验请求失败: ${(e as Error)?.message || e}` });
      }
    }

    // 4) 仅零失败才清理：localStorage → IndexedDB（Promise 化，onblocked 不算成功）→ 迁移标记
    if (failures.length > 0) {
      console.warn('[迁移] 存在失败项，保留旧 localStorage/IndexedDB 数据以便重试:', failures);
      return { migrated: false, migratedItems, failures };
    }

    localStorage.removeItem(LEGACY_KEY_ITEMS);
    localStorage.removeItem(LEGACY_KEY_FOLDERS);
    if (!(await deleteLegacyDatabase())) {
      failures.push({ stage: 'idb', error: '旧 IndexedDB 库删除失败或被其他标签页阻塞' });
      return { migrated: false, migratedItems, failures };
    }
    localStorage.setItem(MIGRATION_FLAG, new Date().toISOString());
    return { migrated: true, migratedItems, failures: [] };
  } catch (e) {
    failures.push({ stage: 'unexpected', error: `迁移意外中止: ${(e as Error)?.message || e}` });
    console.warn('旧数据迁移未完成，将在下次加载时重试', e);
    return { migrated: false, migratedItems, failures };
  }
}

/* ---------------- 首次播种：客户端 Web Audio 合成 → 上传 ---------------- */

async function seedOne(
  item: Omit<AudioItem, 'audioUrl' | 'waveformData' | 'fileSize'>,
  audioUrl: string,
): Promise<AudioItem> {
  const blob = await fetch(audioUrl).then(r => r.blob());
  const waveformData = await extractPeaks(blob);
  return addAudioItem({ ...item, fileSize: blob.size, waveformData } as AudioItem, blob);
}

async function seedStarterAudio(): Promise<AudioItem[]> {
  const saved: AudioItem[] = [];
  try {
    // 1. 赛博能量光束射击
    const laser = await renderSoundRecipe({
      title: '赛博能量光束射击 (Cyber Laser)',
      description: '未来科技武器高能脉冲光束，下潜爆发力十足',
      category: 'sfx',
      duration: 0.9,
      oscillators: [
        { type: 'sawtooth', startFreq: 1800, endFreq: 80, freqRamp: 'exponential', gain: 0.7 },
        { type: 'square', startFreq: 900, endFreq: 60, freqRamp: 'exponential', gain: 0.4 },
      ],
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.35 },
      filter: { type: 'lowpass', startCutoff: 4000, endCutoff: 300, q: 4 },
      effects: { reverb: 0.35 },
    });
    saved.push(await seedOne({
      id: 'init-sfx-laser',
      title: '赛博能量光束射击 (Cyber Laser)',
      description: '未来科技武器高能脉冲光束，下潜爆发力十足',
      category: 'sfx',
      duration: 0.9,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      tags: ['光束', '射击', '科幻', '赛博朋克', '武器'],
      rating: 5,
      folderId: 'f-gamesfx',
      metadata: { source: 'sfx-generator', isAiGenerated: true },
    }, laser.audioUrl));

    // 2. 电影级重低音冲击
    const boom = await renderSoundRecipe({
      title: '电影级重低音冲击 (Cinematic Sub Boom)',
      description: '预告片专用重低音冲击波，震撼深沉',
      category: 'sfx',
      duration: 2.2,
      oscillators: [
        { type: 'sine', startFreq: 120, endFreq: 30, freqRamp: 'exponential', gain: 0.9 },
        { type: 'triangle', startFreq: 80, endFreq: 25, freqRamp: 'exponential', gain: 0.6 },
      ],
      envelope: { attack: 0.01, decay: 0.8, sustain: 0.2, release: 1.2 },
      noise: { type: 'brown', gain: 0.3, duration: 0.6 },
      effects: { reverb: 0.5 },
    });
    saved.push(await seedOne({
      id: 'init-sfx-boom',
      title: '电影级重低音冲击 (Cinematic Sub Boom)',
      description: '电影预告片重低音下潜转场冲击音',
      category: 'sfx',
      duration: 2.2,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
      tags: ['冲击波', '低音下潜', '转场', '电影预告片', '重低音'],
      rating: 4,
      folderId: 'f-gamesfx',
      metadata: { source: 'sfx-generator', isAiGenerated: true },
    }, boom.audioUrl));

    // 3. Lo-Fi 律动
    const lofi = await renderBeatPattern({
      name: '深夜电台 Lo-Fi 律动 (Midnight Chill)',
      bpm: 88,
      scale: 'C Minor',
      tracks: [
        { id: 't1', name: 'Kick Drum', soundType: 'kick', steps: [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false], volume: 0.9 },
        { id: 't2', name: 'Snare / Rim', soundType: 'snare', steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], volume: 0.8 },
        { id: 't3', name: 'Shaker Hat', soundType: 'hihat', steps: Array(16).fill(true), volume: 0.5 },
        { id: 't4', name: 'Deep Sub', soundType: 'bass', steps: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false], notes: ['C2', null, null, null, null, null, 'Eb2', null, null, null, 'G2', null, null, null, null, null], volume: 0.85 },
        { id: 't5', name: 'Lofi Chords', soundType: 'lead', steps: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false], notes: ['Eb4', null, null, 'G4', null, null, 'Bb4', null, null, 'D5', null, null, 'C5', null, null, null], volume: 0.65 },
      ],
    }, 2);
    saved.push(await seedOne({
      id: 'init-music-lofi',
      title: '深夜电台 Lo-Fi 律动 (Midnight Chill)',
      description: '温暖复古的 88 BPM 爵士嘻哈鼓组与柔和合成器旋律',
      category: 'music',
      duration: Math.round(lofi.duration * 10) / 10,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      tags: ['Lo-Fi', '爵士嘻哈', '放松', '88BPM', '鼓点', '伴奏'],
      rating: 5,
      folderId: 'f-lofibgm',
      metadata: { bpm: 88, key: 'C Minor', source: 'beat-sequencer', isAiGenerated: true },
    }, lofi.audioUrl));

    // 4. UI 提示音
    const ui = await renderSoundRecipe({
      title: '极简科技交互提示音 (Modern UI Click)',
      description: '轻脆明亮的玻璃弹跳感微交互提示音',
      category: 'sfx',
      duration: 0.25,
      oscillators: [
        { type: 'sine', startFreq: 1200, endFreq: 2400, freqRamp: 'linear', gain: 0.8 },
      ],
      envelope: { attack: 0.002, decay: 0.08, sustain: 0.01, release: 0.1 },
      effects: { reverb: 0.1 },
    });
    saved.push(await seedOne({
      id: 'init-sfx-uiclick',
      title: '极简科技交互提示音 (Modern UI Click)',
      description: '清脆微交互反馈音，适合App按键、操作成功提醒',
      category: 'sfx',
      duration: 0.25,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
      tags: ['按键音', 'UI音效', '反馈', '清脆', '微交互'],
      rating: 4,
      folderId: 'f-gamesfx',
      metadata: { source: 'sfx-generator', isAiGenerated: true },
    }, ui.audioUrl));

    // 5. 冥想颂钵
    const zen = await renderSoundRecipe({
      title: '冥想颂钵与空灵泛音 (Zen Singing Bowl)',
      description: '舒缓深远的西藏颂钵泛音，具有高谐波共振',
      category: 'sample',
      duration: 3.5,
      oscillators: [
        { type: 'sine', startFreq: 216, endFreq: 216, gain: 0.6 },
        { type: 'sine', startFreq: 432, endFreq: 432, detune: 4, gain: 0.4 },
        { type: 'triangle', startFreq: 648, endFreq: 648, detune: -6, gain: 0.25 },
      ],
      envelope: { attack: 0.05, decay: 1.0, sustain: 0.4, release: 2.2 },
      effects: { reverb: 0.6 },
    });
    saved.push(await seedOne({
      id: 'init-sample-zen',
      title: '冥想颂钵与空灵泛音 (Zen Singing Bowl)',
      description: '432Hz共鸣疗愈音律，天然放松与冥想伴音',
      category: 'sample',
      duration: 3.5,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      tags: ['432Hz', '颂钵', '冥想', '白噪音', '身心疗愈', '氛围'],
      rating: 5,
      folderId: 'f-ambient',
      metadata: { source: 'sfx-generator', isAiGenerated: true },
    }, zen.audioUrl));
  } catch (err) {
    console.error('播种示例素材失败:', err);
  }
  return saved.filter(Boolean);
}
