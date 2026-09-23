/**
 * Qwen 官方音色目录校验单测（硬性约束 #5/#6）
 * Google Voice ID 与 Qwen Speaker ID 是两套命名空间，绝不互转；
 * Qwen speaker 必须是模型运行时返回的官方精确 ID（下划线式，如 uncle_fu）。
 */
import { describe, it, expect } from 'vitest';
import { resolveQwenSpeaker, UnsupportedQwenSpeakerError } from '../../server/engines/qwenWorker';

const OFFICIAL = ['aiden', 'dylan', 'eric', 'ono_anna', 'ryan', 'serena', 'sohee', 'uncle_fu', 'vivian'];
const catalog = { speakers: OFFICIAL, languages: ['Auto', 'Chinese', 'English'] };

describe('resolveQwenSpeaker', () => {
  it('accepts exact official speaker IDs', () => {
    expect(resolveQwenSpeaker('uncle_fu', catalog)).toBe('uncle_fu');
    expect(resolveQwenSpeaker('vivian', catalog)).toBe('vivian');
    expect(resolveQwenSpeaker('ono_anna', catalog)).toBe('ono_anna');
  });

  it('rejects Google Voice IDs - never maps between namespaces (constraint #5)', () => {
    for (const googleVoice of ['Kore', 'Puck', 'Fenrir', 'Charon', 'Zephyr']) {
      expect(() => resolveQwenSpeaker(googleVoice, catalog)).toThrow(UnsupportedQwenSpeakerError);
    }
  });

  it('rejects Gradio display names (constraint #6: official exact IDs only)', () => {
    // Gradio 展示层 Title-Case 名不是官方 ID
    expect(() => resolveQwenSpeaker('Uncle Fu', catalog)).toThrow(UnsupportedQwenSpeakerError);
    expect(() => resolveQwenSpeaker('Uncle_Fu', catalog)).toThrow(UnsupportedQwenSpeakerError); // 大小写也必须精确
    expect(() => resolveQwenSpeaker('Eric', catalog)).toThrow(UnsupportedQwenSpeakerError);
  });

  it('carries the official catalog in the error details', () => {
    try {
      resolveQwenSpeaker('Kore', catalog);
      expect.unreachable('expected rejection');
    } catch (e) {
      const err = e as UnsupportedQwenSpeakerError;
      expect(err.code).toBe('unsupported_speaker');
      expect(err.speaker).toBe('Kore');
      expect(err.details.speakers).toEqual(OFFICIAL);
    }
  });

  it('passes through when the catalog is unavailable (worker is the authority)', () => {
    expect(resolveQwenSpeaker('anything', null)).toBe('anything');
    expect(resolveQwenSpeaker('anything', { speakers: [], languages: [] })).toBe('anything');
  });
});
