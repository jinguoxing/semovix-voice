/**
 * AudioCraft Studio - IndexedDB & Local Storage Manager
 */

import { AudioItem, AudioFolder } from '../types/audio';
import { renderSoundRecipe, renderBeatPattern } from './audioEngine';

const DB_NAME = 'AudioCraftStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'audio_files';
const STORAGE_KEY_ITEMS = 'audiocraft_items_meta';
const STORAGE_KEY_FOLDERS = 'audiocraft_folders';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeAudioBlob(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ id, blob });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('IndexedDB save failed, using memory', e);
  }
}

export async function getAudioBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('IndexedDB retrieve failed', e);
    return null;
  }
}

export async function deleteAudioBlob(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('IndexedDB delete failed', e);
  }
}

// Default system folders
export const DEFAULT_FOLDERS: AudioFolder[] = [
  { id: 'f-podcast', name: '播客与配音集', color: '#38bdf8', createdAt: new Date().toISOString() },
  { id: 'f-gamesfx', name: '游戏与科幻音效', color: '#a855f7', createdAt: new Date().toISOString() },
  { id: 'f-lofibgm', name: 'Lo-Fi 旋律采样', color: '#34d399', createdAt: new Date().toISOString() },
  { id: 'f-ambient', name: '自然白噪音与环境', color: '#fbbf24', createdAt: new Date().toISOString() },
];

export function getFolders(): AudioFolder[] {
  const saved = localStorage.getItem(STORAGE_KEY_FOLDERS);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return DEFAULT_FOLDERS;
    }
  }
  localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(DEFAULT_FOLDERS));
  return DEFAULT_FOLDERS;
}

export function saveFolders(folders: AudioFolder[]) {
  localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
}

export function createFolder(name: string, color = '#6366f1'): AudioFolder {
  const folders = getFolders();
  const newFolder: AudioFolder = {
    id: `f-${Date.now()}`,
    name,
    color,
    createdAt: new Date().toISOString(),
  };
  const updated = [...folders, newFolder];
  saveFolders(updated);
  return newFolder;
}

export function deleteFolder(folderId: string): AudioFolder[] {
  const folders = getFolders().filter(f => f.id !== folderId);
  saveFolders(folders);
  return folders;
}

/**
 * Generate mock waveform peak data if not generated
 */
function generateDummyPeaks(count = 50, seed = 1): number[] {
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const val = 0.2 + 0.7 * Math.abs(Math.sin((i + seed) * 0.45) * Math.cos(i * 0.2));
    peaks.push(Math.round(val * 100) / 100);
  }
  return peaks;
}

/**
 * Initialize starter audio library with synthesized rich audio items
 */
export async function initializeStarterAudio(): Promise<AudioItem[]> {
  const stored = localStorage.getItem(STORAGE_KEY_ITEMS);
  if (stored) {
    try {
      const items: AudioItem[] = JSON.parse(stored);
      // Re-hydrate any blob URLs from IndexedDB if needed
      for (const item of items) {
        if (!item.audioUrl || item.audioUrl.startsWith('blob:')) {
          const blob = await getAudioBlob(item.id);
          if (blob) {
            item.audioUrl = URL.createObjectURL(blob);
          }
        }
      }
      if (items.length > 0) return items;
    } catch (e) {
      console.error('Error loading stored items', e);
    }
  }

  // Pre-generate starter samples
  const starterItems: AudioItem[] = [];

  try {
    // 1. Cyber Laser SFX
    const laserRecipe = {
      title: '赛博能量光束射击 (Cyber Laser)',
      description: '未来科技武器高能光束射击音效，带有高频下潜与空间混响',
      category: 'sfx',
      duration: 0.9,
      oscillators: [
        { type: 'sawtooth' as const, startFreq: 1800, endFreq: 80, freqRamp: 'exponential' as const, gain: 0.7 },
        { type: 'square' as const, startFreq: 900, endFreq: 60, freqRamp: 'exponential' as const, gain: 0.4 },
      ],
      envelope: { attack: 0.005, decay: 0.15, sustain: 0.05, release: 0.35 },
      filter: { type: 'lowpass' as const, startCutoff: 4000, endCutoff: 300, q: 4 },
      effects: { reverb: 0.35 },
    };
    const laserResult = await renderSoundRecipe(laserRecipe);
    const laserBlob = await fetch(laserResult.audioUrl).then(r => r.blob());
    const laserId = 'init-sfx-laser';
    await storeAudioBlob(laserId, laserBlob);

    starterItems.push({
      id: laserId,
      title: '赛博能量光束射击 (Cyber Laser)',
      description: '未来科技武器高能脉冲光束，下潜爆发力十足',
      category: 'sfx',
      duration: 0.9,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      fileSize: laserBlob.size,
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      tags: ['光束', '射击', '科幻', '赛博朋克', '武器'],
      rating: 5,
      folderId: 'f-gamesfx',
      audioUrl: laserResult.audioUrl,
      waveformData: generateDummyPeaks(48, 3),
      metadata: { source: 'sfx-generator', isAiGenerated: true },
    });

    // 2. Cinematic Impact Boom
    const boomRecipe = {
      title: '电影级重低音冲击 (Cinematic Sub Boom)',
      description: '预告片专用重低音冲击波，震撼深沉',
      category: 'sfx',
      duration: 2.2,
      oscillators: [
        { type: 'sine' as const, startFreq: 120, endFreq: 30, freqRamp: 'exponential' as const, gain: 0.9 },
        { type: 'triangle' as const, startFreq: 80, endFreq: 25, freqRamp: 'exponential' as const, gain: 0.6 },
      ],
      envelope: { attack: 0.01, decay: 0.8, sustain: 0.2, release: 1.2 },
      noise: { type: 'brown' as const, gain: 0.3, duration: 0.6 },
      effects: { reverb: 0.5 },
    };
    const boomResult = await renderSoundRecipe(boomRecipe);
    const boomBlob = await fetch(boomResult.audioUrl).then(r => r.blob());
    const boomId = 'init-sfx-boom';
    await storeAudioBlob(boomId, boomBlob);

    starterItems.push({
      id: boomId,
      title: '电影级重低音冲击 (Cinematic Sub Boom)',
      description: '电影预告片重低音下潜转场冲击音',
      category: 'sfx',
      duration: 2.2,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      fileSize: boomBlob.size,
      createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
      tags: ['冲击波', '低音下潜', '转场', '电影预告片', '重低音'],
      rating: 4,
      folderId: 'f-gamesfx',
      audioUrl: boomResult.audioUrl,
      waveformData: generateDummyPeaks(48, 7),
      metadata: { source: 'sfx-generator', isAiGenerated: true },
    });

    // 3. Lo-Fi Hip Hop Beat
    const lofiPattern = {
      name: '深夜电台 Lo-Fi 律动 (Midnight Chill)',
      bpm: 88,
      scale: 'C Minor',
      tracks: [
        { id: 't1', name: 'Kick Drum', soundType: 'kick' as const, steps: [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false], volume: 0.9 },
        { id: 't2', name: 'Snare / Rim', soundType: 'snare' as const, steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], volume: 0.8 },
        { id: 't3', name: 'Shaker Hat', soundType: 'hihat' as const, steps: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], volume: 0.5 },
        { id: 't4', name: 'Deep Sub', soundType: 'bass' as const, steps: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false], notes: ['C2', null, null, null, null, null, 'Eb2', null, null, null, 'G2', null, null, null, null, null], volume: 0.85 },
        { id: 't5', name: 'Lofi Chords', soundType: 'lead' as const, steps: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false], notes: ['Eb4', null, null, 'G4', null, null, 'Bb4', null, null, 'D5', null, null, 'C5', null, null, null], volume: 0.65 },
      ],
    };
    const lofiResult = await renderBeatPattern(lofiPattern, 2);
    const lofiBlob = await fetch(lofiResult.audioUrl).then(r => r.blob());
    const lofiId = 'init-music-lofi';
    await storeAudioBlob(lofiId, lofiBlob);

    starterItems.push({
      id: lofiId,
      title: '深夜电台 Lo-Fi 律动 (Midnight Chill)',
      description: '温暖复古的 88 BPM 爵士嘻哈鼓组与柔和合成器旋律',
      category: 'music',
      duration: Math.round(lofiResult.duration * 10) / 10,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      fileSize: lofiBlob.size,
      createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      tags: ['Lo-Fi', '爵士嘻哈', '放松', '88BPM', '鼓点', '伴奏'],
      rating: 5,
      folderId: 'f-lofibgm',
      audioUrl: lofiResult.audioUrl,
      waveformData: generateDummyPeaks(48, 11),
      metadata: { bpm: 88, key: 'C Minor', source: 'beat-sequencer', isAiGenerated: true },
    });

    // 4. UI Modern Click & Pop
    const uiRecipe = {
      title: '极简科技交互提示音 (Modern UI Click)',
      description: '轻脆明亮的玻璃弹跳感微交互提示音',
      category: 'sfx',
      duration: 0.25,
      oscillators: [
        { type: 'sine' as const, startFreq: 1200, endFreq: 2400, freqRamp: 'linear' as const, gain: 0.8 },
      ],
      envelope: { attack: 0.002, decay: 0.08, sustain: 0.01, release: 0.1 },
      effects: { reverb: 0.1 },
    };
    const uiResult = await renderSoundRecipe(uiRecipe);
    const uiBlob = await fetch(uiResult.audioUrl).then(r => r.blob());
    const uiId = 'init-sfx-uiclick';
    await storeAudioBlob(uiId, uiBlob);

    starterItems.push({
      id: uiId,
      title: '极简科技交互提示音 (Modern UI Click)',
      description: '清脆微交互反馈音，适合App按键、操作成功提醒',
      category: 'sfx',
      duration: 0.25,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      fileSize: uiBlob.size,
      createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
      tags: ['按键音', 'UI音效', '反馈', '清脆', '微交互'],
      rating: 4,
      folderId: 'f-gamesfx',
      audioUrl: uiResult.audioUrl,
      waveformData: generateDummyPeaks(48, 14),
      metadata: { source: 'sfx-generator', isAiGenerated: true },
    });

    // 5. Ambient Singing Bowl & Zen Drone
    const zenRecipe = {
      title: '冥想颂钵与空灵泛音 (Zen Singing Bowl)',
      description: '舒缓深远的西藏颂钵泛音，具有高谐波共振',
      category: 'sample',
      duration: 3.5,
      oscillators: [
        { type: 'sine' as const, startFreq: 216, endFreq: 216, gain: 0.6 },
        { type: 'sine' as const, startFreq: 432, endFreq: 432, detune: 4, gain: 0.4 },
        { type: 'triangle' as const, startFreq: 648, endFreq: 648, detune: -6, gain: 0.25 },
      ],
      envelope: { attack: 0.05, decay: 1.0, sustain: 0.4, release: 2.2 },
      effects: { reverb: 0.6 },
    };
    const zenResult = await renderSoundRecipe(zenRecipe);
    const zenBlob = await fetch(zenResult.audioUrl).then(r => r.blob());
    const zenId = 'init-sample-zen';
    await storeAudioBlob(zenId, zenBlob);

    starterItems.push({
      id: zenId,
      title: '冥想颂钵与空灵泛音 (Zen Singing Bowl)',
      description: '432Hz共鸣疗愈音律，天然放松与冥想伴音',
      category: 'sample',
      duration: 3.5,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      fileSize: zenBlob.size,
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      tags: ['432Hz', '颂钵', '冥想', '白噪音', '身心疗愈', '氛围'],
      rating: 5,
      folderId: 'f-ambient',
      audioUrl: zenResult.audioUrl,
      waveformData: generateDummyPeaks(48, 19),
      metadata: { source: 'sfx-generator', isAiGenerated: true },
    });

  } catch (err) {
    console.error('Error seeding starter audio:', err);
  }

  saveAudioItems(starterItems);
  return starterItems;
}

export function saveAudioItems(items: AudioItem[]) {
  // Store metadata in localStorage (excluding large object URLs)
  const metaOnly = items.map(item => ({
    ...item,
    audioUrl: item.audioUrl.startsWith('data:') ? item.audioUrl : '', // keep data URLs if small, or reload from indexeddb
  }));
  localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(metaOnly));
}

export async function addAudioItem(item: AudioItem, blob?: Blob): Promise<AudioItem> {
  if (blob) {
    await storeAudioBlob(item.id, blob);
  }
  const current = await getAudioItems();
  const updated = [item, ...current];
  saveAudioItems(updated);
  return item;
}

export async function getAudioItems(): Promise<AudioItem[]> {
  const stored = localStorage.getItem(STORAGE_KEY_ITEMS);
  if (!stored) {
    return initializeStarterAudio();
  }
  try {
    const items: AudioItem[] = JSON.parse(stored);
    for (const item of items) {
      if (!item.audioUrl || item.audioUrl.length === 0) {
        const blob = await getAudioBlob(item.id);
        if (blob) {
          item.audioUrl = URL.createObjectURL(blob);
        }
      }
    }
    return items;
  } catch {
    return initializeStarterAudio();
  }
}

export async function updateAudioItem(id: string, updates: Partial<AudioItem>): Promise<AudioItem[]> {
  const items = await getAudioItems();
  const updated = items.map(item => (item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item));
  saveAudioItems(updated);
  return updated;
}

export async function deleteAudioItem(id: string): Promise<AudioItem[]> {
  await deleteAudioBlob(id);
  const items = await getAudioItems();
  const updated = items.filter(item => item.id !== id);
  saveAudioItems(updated);
  return updated;
}

export async function deleteMultipleAudioItems(ids: string[]): Promise<AudioItem[]> {
  for (const id of ids) {
    await deleteAudioBlob(id);
  }
  const items = await getAudioItems();
  const updated = items.filter(item => !ids.includes(item.id));
  saveAudioItems(updated);
  return updated;
}

export async function moveAudioToFolder(ids: string[], folderId?: string): Promise<AudioItem[]> {
  const items = await getAudioItems();
  const updated = items.map(item => (ids.includes(item.id) ? { ...item, folderId } : item));
  saveAudioItems(updated);
  return updated;
}

export async function batchAddTags(ids: string[], newTags: string[]): Promise<AudioItem[]> {
  const items = await getAudioItems();
  const updated = items.map(item => {
    if (ids.includes(item.id)) {
      const merged = Array.from(new Set([...item.tags, ...newTags]));
      return { ...item, tags: merged };
    }
    return item;
  });
  saveAudioItems(updated);
  return updated;
}
