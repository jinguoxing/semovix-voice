/**
 * 旧数据迁移单元测试（P01 数据完整性）：
 * 部分失败时必须保留 localStorage/IndexedDB 旧数据，全部成功才清理。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** 内存 localStorage 桩 */
function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    _store: store,
  };
}

const LEGACY_KEY_ITEMS = 'audiocraft_items_meta';
const LEGACY_KEY_FOLDERS = 'audiocraft_folders';
const MIGRATION_FLAG = 'audiocraft_server_migration_v1';

const twoLegacyItems = JSON.stringify([
  { id: 'old-1', title: '旧素材一', format: 'wav', audioUrl: 'data:audio/wav;base64,AAAA' },
  { id: 'old-2', title: '旧素材二', format: 'wav', audioUrl: 'data:audio/wav;base64,BBBB' },
]);

let ls: ReturnType<typeof makeLocalStorage>;
let deleteDatabaseCalls: string[];

function installGlobals(fetchImpl: (url: string, init?: any) => Promise<Response>) {
  ls = makeLocalStorage();
  deleteDatabaseCalls = [];
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', {
    indexedDB: { deleteDatabase: (name: string) => void deleteDatabaseCalls.push(name) },
  });
  vi.stubGlobal('indexedDB', { deleteDatabase: (name: string) => void deleteDatabaseCalls.push(name) });
  const fetchMock = vi.fn(fetchImpl as any);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('migrateLegacyDataIfNeeded()', () => {
  it('keeps legacy localStorage data when any item fails (partial failure)', async () => {
    // 上传接口对第一个素材成功、第二个素材 502 → 部分失败
    let uploadCalls = 0;
    installGlobals(async (url: string) => {
      if (url.startsWith('data:')) return new Response('blob-bytes', { status: 200 });
      uploadCalls++;
      if (uploadCalls === 2) return new Response('boom', { status: 502 });
      return new Response(JSON.stringify({ item: { id: `saved-${uploadCalls}` } }), { status: 200 });
    });

    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, JSON.stringify([{ id: 'f-1', name: '旧文件夹' }]));

    const { migrateLegacyDataIfNeeded } = await import('../../src/utils/audioStorage');
    await migrateLegacyDataIfNeeded();

    // 验收：部分失败 → 旧数据必须原样保留，且不设迁移完成标记（下次重试）
    expect(ls.getItem(LEGACY_KEY_ITEMS)).toBe(twoLegacyItems);
    expect(ls.getItem(LEGACY_KEY_FOLDERS)).toBeTruthy();
    expect(ls.getItem(MIGRATION_FLAG)).toBeNull();
    expect(deleteDatabaseCalls).toEqual([]); // IndexedDB 不得被删除
  });

  it('cleans legacy data only after every item migrates successfully', async () => {
    installGlobals(async (url: string) => {
      if (url.startsWith('data:')) return new Response('blob-bytes', { status: 200 });
      return new Response(JSON.stringify({ item: { id: 'ok' } }), { status: 200 });
    });

    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, JSON.stringify([{ id: 'f-1', name: '旧文件夹' }]));

    const { migrateLegacyDataIfNeeded } = await import('../../src/utils/audioStorage');
    await migrateLegacyDataIfNeeded();

    expect(ls.getItem(LEGACY_KEY_ITEMS)).toBeNull();
    expect(ls.getItem(LEGACY_KEY_FOLDERS)).toBeNull();
    expect(ls.getItem(MIGRATION_FLAG)).toBeTruthy();
    expect(deleteDatabaseCalls).toContain('AudioCraftStudioDB');
  });

  it('is a no-op when the migration flag is already set', async () => {
    const fetchSpy = installGlobals(async () => {
      throw new Error('should not be called');
    });
    ls.setItem(MIGRATION_FLAG, new Date().toISOString());

    const { migrateLegacyDataIfNeeded } = await import('../../src/utils/audioStorage');
    await migrateLegacyDataIfNeeded();

    expect((fetchSpy as any).mock.calls.length).toBe(0);
  });
});
