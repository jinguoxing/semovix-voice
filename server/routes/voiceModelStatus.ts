/**
 * 0. Voice Model Status & Configuration Info
 * （自 server.ts 原样迁移）
 */
import { Router } from 'express';
import { ttsAdapters } from '../engines/tts';
import { LOCAL_REASONING_ID, ollamaIsAvailable, ollamaModelName } from '../engines/reasoning';
import { LOCAL_TRANSCRIBE_ID, whisperIsAvailable } from '../engines/asr';
import { hasGeminiApiKey } from '../engines/geminiClient';

export const voiceModelStatusRouter = Router();

voiceModelStatusRouter.get('/voice-model/status', async (req, res) => {
  const engines = await Promise.all(
    ttsAdapters.map(async a => ({
      id: a.id,
      label: a.label,
      requiresApiKey: a.requiresApiKey,
      available: await a.isAvailable(),
    }))
  );
  // 本地推理/转录引擎一并上报，前端可据此提示是否需要先启动对应服务
  const [ollamaUp, whisperUp] = await Promise.all([ollamaIsAvailable(), whisperIsAvailable()]);
  engines.push(
    { id: LOCAL_REASONING_ID, label: `Qwen (Ollama ${ollamaModelName()})`, requiresApiKey: false, available: ollamaUp },
    { id: LOCAL_TRANSCRIBE_ID, label: 'Whisper large-v3-turbo (本地)', requiresApiKey: false, available: whisperUp },
  );

  res.json({
    status: hasGeminiApiKey() ? 'connected' : 'local_fallback',
    configured: Boolean(hasGeminiApiKey()),
    engine: 'Google Gemini Audio Multimodal',
    models: {
      tts: 'gemini-2.5-flash-preview-tts',
      transcribe: 'gemini-2.5-flash',
      reasoning: 'gemini-2.5-flash',
    },
    engines,
    supportedVoices: [
      { id: 'Kore', name: 'Kore', gender: '男声', title: '权威男中音', tag: '沉稳睿智' },
      { id: 'Puck', name: 'Puck', gender: '男声', title: '朝气男高音', tag: '活力轻快' },
      { id: 'Fenrir', name: 'Fenrir', gender: '男声', title: '电影级重低音', tag: '磁性厚重' },
      { id: 'Charon', name: 'Charon', gender: '男声', title: '播音级标准音', tag: '专业播报' },
      { id: 'Zephyr', name: 'Zephyr', gender: '女声', title: '知性疗愈女声', tag: '温暖知性' },
    ],
    sampleRate: 24000,
    container: 'WAV (RIFF Header, 16-bit PCM)',
  });
});
