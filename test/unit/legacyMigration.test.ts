/**
 * 旧数据迁移事务单元测试（P01 三：旧数据迁移事务）
 *
 * 8 个验收场景：任何阶段（folders-parse/folders-upload/item-read/item-upload/verify/idb）
 * 失败都必须保留旧 localStorage/IndexedDB 数据且不设迁移标记；
 * 只有「全部成功 + 服务端复验通过 + IndexedDB 删除成功」才清理并落标记。
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
const LEGACY_DB_NAME = 'AudioCraftStudioDB';

const twoLegacyItems = JSON.stringify([
  { id: 'old-1', title: '旧素材一', format: 'wav', audioUrl: 'data:audio/wav;base64,AAAA' },
  { id: 'old-2', title: '旧素材二', format: 'wav', audioUrl: 'data:audio/wav;base64,BBBB' },
]);

/** 无 data: URL 的旧素材：只能从 IndexedDB 取 blob */
const idbOnlyItems = JSON.stringify([
  { id: 'old-1', title: '旧素材一', format: 'wav' },
  { id: 'old-2', title: '旧素材二', format: 'wav' },
]);

const legacyFolders = JSON.stringify([{ id: 'f-1', name: '旧文件夹' }]);

interface FetchPlan {
  foldersReplace?: () => Response;
  itemsUpload?: (id: string, call: number) => Response;
  /** 复验 GET /items 返回的服务端素材（默认两条都在） */
  serverItems?: Array<{ id: string }>;
  /** 复验 GET /folders 返回的服务端文件夹 */
  serverFolders?: Array<{ id: string }>;
}

let ls: ReturnType<typeof makeLocalStorage>;
let idbDeleteCalls: string[];

function installGlobals(plan: FetchPlan = {}) {
  ls = makeLocalStorage();
  idbDeleteCalls = [];
  let uploadCalls = 0;

  const fetchMock = vi.fn(async (url: string, init?: any) => {
    if (url.startsWith('data:')) return new Response('blob-bytes', { status: 200 });
    const method = init?.method ?? 'GET';

    if (url === '/api/library/folders/replace') {
      return plan.foldersReplace
        ? plan.foldersReplace()
        : new Response(JSON.stringify({ folders: [{ id: 'f-1' }] }), { status: 200 });
    }
    if (url === '/api/library/items' && method === 'POST') {
      uploadCalls++;
      const item = JSON.parse(init.body.get('item'));
      return plan.itemsUpload
        ? plan.itemsUpload(item.id, uploadCalls)
        : new Response(JSON.stringify({ item: { id: item.id } }), { status: 200 });
    }
    if (url === '/api/library/items') {
      // 服务端复验
      return new Response(
        JSON.stringify({ items: plan.serverItems ?? [{ id: 'old-1' }, { id: 'old-2' }] }),
        { status: 200 },
      );
    }
    if (url === '/api/library/folders') {
      return new Response(
        JSON.stringify({ folders: plan.serverFolders ?? [{ id: 'f-1' }] }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });

  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('fetch', fetchMock);
  // 无 .open → legacyOpenDB 返回 null（模拟 IndexedDB 不可打开）；deleteDatabase 返回非标准桩对象
  vi.stubGlobal('indexedDB', {
    deleteDatabase: (name: string) => {
      idbDeleteCalls.push(name);
      return {} as any;
    },
  });
  vi.stubGlobal('window', { indexedDB: { deleteDatabase: () => ({}) } });
  return fetchMock;
}

async function runMigration() {
  const { migrateLegacyDataIfNeeded } = await import('../../src/utils/audioStorage');
  return migrateLegacyDataIfNeeded();
}

/** 断言：旧数据未清理、未设迁移标记 */
function expectLegacyKept() {
  expect(ls.getItem(LEGACY_KEY_ITEMS)).toBeTruthy();
  expect(ls.getItem(LEGACY_KEY_FOLDERS)).toBeTruthy();
  expect(ls.getItem(MIGRATION_FLAG)).toBeNull();
  expect(idbDeleteCalls).toEqual([]); // IndexedDB 不得被删除
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('migrateLegacyDataIfNeeded()（P01 迁移事务）', () => {
  it('1. 旧文件夹 JSON 损坏 → folders-parse 失败，保留旧数据', async () => {
    installGlobals();
    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, '{corrupt json');

    const res = await runMigration();

    expect(res.migrated).toBe(false);
    expect(res.failures.some(f => f.stage === 'folders-parse')).toBe(true);
    expectLegacyKept();
  });

  it('2. /folders/replace 500 → folders-upload 失败，保留旧数据', async () => {
    installGlobals({ foldersReplace: () => new Response('boom', { status: 500 }) });
    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, legacyFolders);

    const res = await runMigration();

    expect(res.migrated).toBe(false);
    expect(res.failures.some(f => f.stage === 'folders-upload')).toBe(true);
    expectLegacyKept();
  });

  it('3. 文件夹成功 + 部分素材上传失败 → item-upload 失败，保留旧数据', async () => {
    installGlobals({
      itemsUpload: id =>
        id === 'old-2' ? new Response('boom', { status: 502 }) : new Response(JSON.stringify({ item: { id } }), { status: 200 }),
    });
    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, legacyFolders);

    const res = await runMigration();

    expect(res.migrated).toBe(false);
    expect(res.migratedItems).toBe(1); // old-1 已搬入（upsert 幂等，重试安全）
    expect(res.failures).toEqual([expect.objectContaining({ stage: 'item-upload', id: 'old-2' })]);
    expectLegacyKept();
  });

  it('4. 文件夹失败 + 素材全部成功 → 文件夹失败同样阻断清理', async () => {
    installGlobals({ foldersReplace: () => new Response('boom', { status: 500 }) });
    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, legacyFolders);

    const res = await runMigration();

    expect(res.migrated).toBe(false);
    expect(res.migratedItems).toBe(2); // 素材已成功搬入服务端
    expect(res.failures.some(f => f.stage === 'folders-upload')).toBe(true);
    expectLegacyKept(); // 但文件夹失败 → 旧数据仍不得清理
  });

  it('5. IndexedDB 不可用且素材无 data: URL → item-read 失败，保留旧数据', async () => {
    installGlobals(); // indexedDB 桩无 .open
    ls.setItem(LEGACY_KEY_ITEMS, idbOnlyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, legacyFolders);

    const res = await runMigration();

    expect(res.migrated).toBe(false);
    expect(res.migratedItems).toBe(0);
    expect(res.failures.filter(f => f.stage === 'item-read').map(f => f.id)).toEqual(['old-1', 'old-2']);
    expectLegacyKept();
  });

  it('6. 服务端复验发现素材缺失 → verify 失败，保留旧数据', async () => {
    installGlobals({ serverItems: [{ id: 'old-1' }] }); // old-2 缺失
    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, legacyFolders);

    const res = await runMigration();

    expect(res.migrated).toBe(false);
    expect(res.failures).toEqual([expect.objectContaining({ stage: 'verify', id: 'old-2' })]);
    expectLegacyKept();
  });

  it('7. 全部成功 + 复验通过 → 清理 localStorage/IndexedDB 并落迁移标记', async () => {
    installGlobals();
    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, legacyFolders);

    const res = await runMigration();

    expect(res.migrated).toBe(true);
    expect(res.migratedItems).toBe(2);
    expect(res.failures).toEqual([]);
    expect(ls.getItem(LEGACY_KEY_ITEMS)).toBeNull();
    expect(ls.getItem(LEGACY_KEY_FOLDERS)).toBeNull();
    expect(ls.getItem(MIGRATION_FLAG)).toBeTruthy();
    expect(idbDeleteCalls).toEqual([LEGACY_DB_NAME]);
  });

  it('8. 失败后重试幂等：第一次部分失败不落标记，第二次全部成功后清理', async () => {
    let failOld2 = true;
    installGlobals({
      itemsUpload: id =>
        failOld2 && id === 'old-2'
          ? new Response('boom', { status: 502 })
          : new Response(JSON.stringify({ item: { id } }), { status: 200 }),
    });
    ls.setItem(LEGACY_KEY_ITEMS, twoLegacyItems);
    ls.setItem(LEGACY_KEY_FOLDERS, legacyFolders);

    const first = await runMigration();
    expect(first.migrated).toBe(false);
    expect(ls.getItem(MIGRATION_FLAG)).toBeNull();

    failOld2 = false; // 环境修复（如 Worker 恢复）后重试
    const second = await runMigration();
    expect(second.migrated).toBe(true);
    expect(second.migratedItems).toBe(2);
    expect(ls.getItem(LEGACY_KEY_ITEMS)).toBeNull();
    expect(ls.getItem(MIGRATION_FLAG)).toBeTruthy();
    expect(idbDeleteCalls).toEqual([LEGACY_DB_NAME]);
  });
});
