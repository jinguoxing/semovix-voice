import { describe, expect, it, vi } from 'vitest';
import { generateGuofeng } from '../../src/music/guofengApi';
import { createGuofengComposition, type GuofengRequest } from '../../src/music/guofeng';

const request: GuofengRequest = {
  prompt: '雨后竹林', mood: '空灵', scene: '竹林', durationSec: 20,
  bpm: 96, key: 0, scale: 'major-pentatonic', instruments: ['guzheng', 'dizi'],
};

describe('国风编曲接口', () => {
  it('空 JSON 响应时仍生成可用编曲，并说明使用了内置模板', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await generateGuofeng(request, 'qwen-local-reasoning', fetcher);
    expect(result.engine).toBe('rules');
    expect(result.composition.sections.map(section => section.id)).toEqual(['intro', 'theme', 'outro']);
    expect(result.warning).toMatch(/空响应.*内置编曲模板/);
  });

  it('参数错误仍显示服务端错误，不用模板掩盖', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '时长无效' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    }));
    await expect(generateGuofeng(request, undefined, fetcher)).rejects.toThrow('时长无效');
  });

  it('正常模型响应保持模型生成的编曲', async () => {
    const composition = createGuofengComposition(request, undefined, 'ollama');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ composition, engine: 'ollama' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const result = await generateGuofeng(request, 'qwen-local-reasoning', fetcher);
    expect(result.engine).toBe('ollama');
    expect(result.composition).toEqual(composition);
    expect(result.warning).toBeUndefined();
  });

  it('服务端错误时仍可用内置模板创作', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 502 }));
    const result = await generateGuofeng(request, undefined, fetcher);
    expect(result.composition.generator).toBe('rules');
    expect(result.warning).toContain('HTTP 502');
  });
});
