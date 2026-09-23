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

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000; // 32KB，避免 apply 栈溢出
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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

/** 上传素材：data: URL 或 Blob → 服务端文件；返回带服务端 audioUrl 的素材 */
export async function addAudioItem(item: AudioItem, blob?: Blob): Promise<AudioItem> {
  let audioBase64: string | undefined;
  let payloadBlob = blob;

  if (!payloadBlob && item.audioUrl?.startsWith('data:')) {
    payloadBlob = await (await fetch(item.audioUrl)).blob();
  }
  if (payloadBlob) {
    audioBase64 = await blobToBase64(payloadBlob);
  }

  const { item: saved } = await api<{ item: AudioItem }>('/items', {
    method: 'POST',
    body: JSON.stringify({ item, audioBase64 }),
  });
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

export async function updateAudioItem(id: string, updates: Partial<AudioItem>): Promise<AudioItem[]> {
  const { items } = await api<{ items: AudioItem[] }>(`/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return items;
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

function legacyOpenDB(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (!('indexedDB' in window)) return resolve(null);
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

async function migrateLegacyDataIfNeeded(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG)) return;

  try {
    const rawItems = localStorage.getItem(LEGACY_KEY_ITEMS);
    const rawFolders = localStorage.getItem(LEGACY_KEY_FOLDERS);

    // 1) 文件夹：整表搬到服务端（服务端空库会播种默认文件夹，这里覆盖为用户实际有的）
    if (rawFolders) {
      try {
        const folders: AudioFolder[] = JSON.parse(rawFolders);
        if (Array.isArray(folders) && folders.length) {
          await api('/folders/replace', { method: 'POST', body: JSON.stringify({ folders }) });
        }
      } catch { /* 损坏的旧数据直接丢弃 */ }
    }

    // 2) 素材：meta + IndexedDB blob / data: URL → 服务端文件
    let migratedCount = 0;
    if (rawItems) {
      try {
        const items: AudioItem[] = JSON.parse(rawItems);
        const db = await legacyOpenDB();
        for (const item of items) {
          try {
            let blob: Blob | null = null;
            if (item.audioUrl?.startsWith('data:')) {
              blob = await (await fetch(item.audioUrl)).blob();
            } else if (db) {
              blob = await legacyGetBlob(db, item.id);
            }
            if (!blob) {
              console.warn(`迁移跳过 ${item.id}：找不到音频数据`);
              continue;
            }
            await addAudioItem(
              { ...item, audioUrl: '' },
              blob,
            );
            migratedCount++;
          } catch (e) {
            console.warn(`迁移素材 ${item.id} 失败，跳过`, e);
          }
        }
        db?.close();
      } catch { /* 损坏的旧数据直接丢弃 */ }
    }

    if (migratedCount > 0) {
      console.log(`[迁移] ${migratedCount} 条旧素材已搬入服务端素材库`);
    }

    // 3) 清理旧数据（释放 localStorage 配额与 IndexedDB 空间）
    localStorage.removeItem(LEGACY_KEY_ITEMS);
    localStorage.removeItem(LEGACY_KEY_FOLDERS);
    if ('indexedDB' in window) {
      indexedDB.deleteDatabase(LEGACY_DB_NAME);
    }
    localStorage.setItem(MIGRATION_FLAG, new Date().toISOString());
  } catch (e) {
    console.warn('旧数据迁移未完成，将在下次加载时重试', e);
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
