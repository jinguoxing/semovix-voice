/**
 * 音频原子写入单元测试（P01 五：音频原子写入）：
 * - 成功路径：文件落盘 + sha256/mimeType/verifiedAt 落库 + 无临时/备份残留；
 * - 失败路径（注入 updateMeta 抛错）：磁盘文件与 DB 元数据都回到写入前状态。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { encodeWav } from '../../server/audio/wav';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semovix-atomic-'));
  vi.resetModules();
  process.env.SEMOVIX_LIBRARY_DIR = dir;
});

afterEach(() => {
  delete process.env.SEMOVIX_LIBRARY_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

function makeWav(sampleRate: number, frames: number): Buffer {
  const pcm = Buffer.alloc(frames * 2); // 16-bit mono
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i * 0.1)), i * 2);
  return encodeWav(pcm, { sampleRate, channels: 1, bitsPerSample: 16 });
}

async function importStore() {
  return import('../../server/db/libraryStore');
}

describe('writeItemFileAtomic()', () => {
  it('writes the file, records sha256/mimeType/verifiedAt, leaves no temp residue', async () => {
    const store = await importStore();
    store.saveItem({ id: 'a1', title: '原子写入', format: 'wav' });
    const wav = makeWav(24000, 100);
    const sha = crypto.createHash('sha256').update(wav).digest('hex');

    const res = store.writeItemFileAtomic('a1', 'wav', wav, {
      mimeType: 'audio/wav',
      audio: { duration: 0.1, sampleRate: 24000, channels: 1 },
    });

    expect(res.sha256).toBe(sha);
    expect(fs.readFileSync(path.join(dir, 'files', 'a1.wav')).equals(wav)).toBe(true);

    const item = store.getItem('a1');
    expect(item.sha256).toBe(sha);
    expect(item.mimeType).toBe('audio/wav');
    expect(item.verifiedAt).toBeTruthy();
    expect(item.sampleRate).toBe(24000);
    expect(item.fileSize).toBe(wav.length);
    expect(fs.readdirSync(path.join(dir, 'files', '.tmp'))).toEqual([]);
  });

  it('rolls back to the previous file when the DB update fails (injectable updateMeta)', async () => {
    const store = await importStore();
    store.saveItem({ id: 'a2', title: '待覆盖', format: 'wav' });
    const original = makeWav(24000, 100);
    store.writeItemFileAtomic('a2', 'wav', original, { mimeType: 'audio/wav' });
    const filePath = path.join(dir, 'files', 'a2.wav');
    const beforeBytes = fs.readFileSync(filePath);

    const replacement = makeWav(48000, 50);
    expect(() =>
      store.writeItemFileAtomic('a2', 'wav', replacement, {
        updateMeta: () => {
          throw new Error('db down');
        },
      })
    ).toThrow('db down');

    // 磁盘：旧文件逐字节恢复；临时/备份无残留
    expect(fs.readFileSync(filePath).equals(beforeBytes)).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'files', '.tmp'))).toEqual([]);
    // DB：元数据停在写入前
    const item = store.getItem('a2');
    expect(item.fileSize).toBe(original.length);
    expect(item.sampleRate).toBe(24000);
  });
});
