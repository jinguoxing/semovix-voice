/**
 * 官方音色目录客户端单元测试（P01）：
 * - 命中 /voices 端点、60s TTL 内不重复请求、TTL 过期后重新拉取、force 绕过 TTL；
 * - 获取失败且无缓存 → null（绝不猜测 speaker，交给 worker 权威校验）；
 * - 获取失败但有缓存 → 回退上次成功值。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const BASE = 'http://worker.test:8800';

let fetches: string[] = [];
let respond: () => Promise<Response>;
let nowMs = 1_700_000_000_000;
let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  process.env.SEMOVIX_WORKER_URL = BASE;
  fetches = [];
  nowMs = 1_700_000_000_000;
  nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
  vi.stubGlobal('fetch', ((url: string) => {
    fetches.push(url);
    return respond();
  }) as typeof fetch);
  const { resetConfigCache } = await import('../../server/config');
  resetConfigCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  nowSpy.mockRestore();
  delete process.env.SEMOVIX_WORKER_URL;
});

function importClient() {
  return import('../../server/engines/qwenWorker');
}

/** 目录响应计划：payload 可变，用 status 控制成败 */
function okCatalog(payload: { speakers: string[]; languages: string[] }) {
  respond = () =>
    Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

describe('qwenVoiceCatalog', () => {
  it('fetches /voices once and serves from cache within the TTL', async () => {
    const { qwenVoiceCatalog } = await importClient();
    okCatalog({ speakers: ['aiden', 'uncle_fu'], languages: ['Auto', 'Chinese'] });

    const first = await qwenVoiceCatalog();
    expect(first).toEqual({ speakers: ['aiden', 'uncle_fu'], languages: ['Auto', 'Chinese'] });
    expect(fetches).toEqual([`${BASE}/voices`]);

    nowMs += 59_000; // TTL 内
    expect(await qwenVoiceCatalog()).toEqual(first);
    expect(fetches).toHaveLength(1); // 未重复请求
  });

  it('refetches after the 60s TTL expires', async () => {
    const { qwenVoiceCatalog } = await importClient();
    okCatalog({ speakers: ['aiden'], languages: ['Auto'] });
    await qwenVoiceCatalog();

    nowMs += 61_000; // TTL 过期
    okCatalog({ speakers: ['vivian'], languages: ['Auto'] });
    expect(await qwenVoiceCatalog()).toEqual({ speakers: ['vivian'], languages: ['Auto'] });
    expect(fetches).toHaveLength(2);
  });

  it('force bypasses the TTL (engine just turned ready)', async () => {
    const { qwenVoiceCatalog } = await importClient();
    okCatalog({ speakers: ['aiden'], languages: ['Auto'] });
    await qwenVoiceCatalog();

    okCatalog({ speakers: ['serena'], languages: ['Auto'] });
    expect(await qwenVoiceCatalog({ force: true })).toEqual({ speakers: ['serena'], languages: ['Auto'] });
    expect(fetches).toHaveLength(2);
  });

  it('returns null when /voices fails and there is no cache (never guess speakers)', async () => {
    const { qwenVoiceCatalog } = await importClient();
    respond = () => Promise.resolve(new Response('not ready', { status: 503 }));
    expect(await qwenVoiceCatalog()).toBeNull();
    expect(fetches).toHaveLength(1);
  });

  it('returns null when the request itself rejects and there is no cache', async () => {
    const { qwenVoiceCatalog } = await importClient();
    respond = () => Promise.reject(new Error('ECONNREFUSED'));
    expect(await qwenVoiceCatalog()).toBeNull();
  });

  it('falls back to the last good catalog when a refresh fails', async () => {
    const { qwenVoiceCatalog } = await importClient();
    okCatalog({ speakers: ['aiden', 'uncle_fu'], languages: ['Auto', 'Chinese'] });
    await qwenVoiceCatalog();

    nowMs += 61_000; // 过期后刷新失败
    respond = () => Promise.resolve(new Response('boom', { status: 500 }));
    expect(await qwenVoiceCatalog()).toEqual({ speakers: ['aiden', 'uncle_fu'], languages: ['Auto', 'Chinese'] });
  });
});
