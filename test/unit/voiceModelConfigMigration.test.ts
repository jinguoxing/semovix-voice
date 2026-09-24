/**
 * 旧音色配置迁移单测（P01 二）：
 * - legacy defaultVoice / dialogueSpeakerN.voice 一次性迁入 voiceSelections.gemini；
 * - 已是新格式的配置不被 legacy 字段覆盖；
 * - 损坏 JSON / 无存储 → 回落默认值；
 * - 历史虚构模型 ID 归一化为真实模型（不带假 ID 请求上游）。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getVoiceModelConfig, DEFAULT_VOICE_MODEL_CONFIG } from '../../src/utils/voiceModelConfig';

const STORAGE_KEY = 'audiocraft_voice_llm_config';

function stubLocalStorage(initial: Record<string, string> = {}): void {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('getVoiceModelConfig migration', () => {
  it('returns the default config (with gemini voiceSelections) when nothing is stored', () => {
    stubLocalStorage();
    const config = getVoiceModelConfig();
    expect(config).toEqual(DEFAULT_VOICE_MODEL_CONFIG);
    expect(config.voiceSelections.gemini).toEqual({
      defaultVoice: 'Kore',
      dialogueSpeaker1Voice: 'Kore',
      dialogueSpeaker2Voice: 'Puck',
    });
  });

  it('migrates legacy defaultVoice / dialogue voices into voiceSelections.gemini once', () => {
    stubLocalStorage({
      [STORAGE_KEY]: JSON.stringify({
        ttsModel: 'gemini-3.1-flash-tts-preview', // 历史虚构 ID
        defaultVoice: 'Fenrir',
        dialogueSpeaker1: { name: '主持', voice: 'Charon' },
        dialogueSpeaker2: { name: '嘉宾', voice: 'Zephyr' },
      }),
    });
    const config = getVoiceModelConfig();
    expect(config.voiceSelections.gemini).toEqual({
      defaultVoice: 'Fenrir',
      dialogueSpeaker1Voice: 'Charon',
      dialogueSpeaker2Voice: 'Zephyr',
    });
    // 虚构模型 ID 归一化为真实模型
    expect(config.ttsModel).toBe('gemini-2.5-flash-preview-tts');
    // legacy 字段保留一个版本（回滚兼容），读取以 voiceSelections 为准
    expect(config.dialogueSpeaker1.voice).toBe('Charon');
  });

  it('does not overwrite an already-migrated voiceSelections.gemini', () => {
    stubLocalStorage({
      [STORAGE_KEY]: JSON.stringify({
        defaultVoice: 'Kore', // legacy 字段更旧，不得覆盖新格式
        voiceSelections: {
          gemini: { defaultVoice: 'Puck', dialogueSpeaker1Voice: 'Fenrir', dialogueSpeaker2Voice: 'Zephyr' },
        },
      }),
    });
    const config = getVoiceModelConfig();
    const gemini = config.voiceSelections.gemini;
    expect(gemini).toBeDefined();
    expect(gemini?.defaultVoice).toBe('Puck');
    expect(gemini?.dialogueSpeaker2Voice).toBe('Zephyr');
  });

  it('falls back to defaults on corrupt JSON instead of throwing', () => {
    stubLocalStorage({ [STORAGE_KEY]: 'not json {{' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(getVoiceModelConfig()).toEqual(DEFAULT_VOICE_MODEL_CONFIG);
    } finally {
      warn.mockRestore();
    }
  });
});
