/**
 * 0. Voice Model Status & Configuration Info
 * P01：接入 Worker 冷启动状态机——每个引擎上报 { reachable, state, available, error }，
 *      available ≡ state === 'ready'；cold/loading 如实展示（前端据此预热/轮询），
 *      并提供 POST /api/engines/{qwen_tts,whisper_asr}/warmup 显式预热。
 */
import { Router } from 'express';
import { LOCAL_REASONING_ID, ollamaIsAvailable, ollamaModelName } from '../engines/reasoning';
import { LOCAL_TRANSCRIBE_ID } from '../engines/asr';
import { hasGeminiApiKey } from '../engines/geminiClient';
import { getWorkerStatus, qwenVoiceCatalog, warmupWorkerEngine, type WorkerEngineId } from '../engines/qwenWorker';
import { fail } from './respond';

export const voiceModelStatusRouter = Router();

/** 允许预热的引擎（Worker 引擎名 → 路由参数） */
const WARMUP_ENGINES: Record<string, WorkerEngineId> = {
  qwen_tts: 'qwen_tts',
  voice_design: 'voice_design',
  whisper_asr: 'whisper_asr',
};

voiceModelStatusRouter.get('/voice-model/status', async (_req, res) => {
  const [worker, ollamaUp] = await Promise.all([getWorkerStatus(), ollamaIsAvailable()]);
  // 引擎已 ready 时绕过目录缓存 TTL：冷启动→就绪的瞬间就能拿到官方音色（P01）
  const qwenCatalog = await qwenVoiceCatalog({ force: worker.qwen_tts.state === 'ready' });

  const geminiReady = hasGeminiApiKey();
  const engines = [
    {
      id: 'gemini',
      label: 'Google Gemini Audio',
      reachable: true,
      state: geminiReady ? 'ready' : 'cold',
      available: geminiReady,
      error: geminiReady ? null : '未配置 Gemini API key（云端引擎不可用）',
    },
    {
      id: 'qwen3-tts-local',
      label: 'Qwen3-TTS 1.7B (Worker)',
      reachable: worker.reachable,
      state: worker.qwen_tts.state,
      available: worker.qwen_tts.state === 'ready',
      error: worker.qwen_tts.error,
    },
    {
      id: 'qwen3-tts-voice-design',
      label: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign (Worker)',
      reachable: worker.reachable,
      state: worker.voice_design.state,
      available: worker.voice_design.available,
      error: worker.voice_design.error,
    },
    {
      id: LOCAL_REASONING_ID,
      label: `Qwen (Ollama ${ollamaModelName()})`,
      reachable: ollamaUp,
      state: ollamaUp ? 'ready' : 'cold',
      available: ollamaUp,
      error: null,
    },
    {
      id: LOCAL_TRANSCRIBE_ID,
      label: 'Whisper large-v3-turbo (Worker)',
      reachable: worker.reachable,
      state: worker.whisper_asr.state,
      available: worker.whisper_asr.state === 'ready',
      error: worker.whisper_asr.error,
    },
  ];

  res.json({
    status: geminiReady ? 'connected' : 'local_fallback',
    configured: geminiReady,
    engine: 'Google Gemini Audio Multimodal',
    models: {
      tts: 'gemini-2.5-flash-preview-tts',
      transcribe: 'gemini-2.5-flash',
      reasoning: 'gemini-2.5-flash',
    },
    engines,
    // 硬性约束 #5：Google Voice ID 与 Qwen Speaker ID 是两套独立命名空间，按引擎分列，不得混用
    voices: {
      gemini: [
        { id: 'Kore', name: 'Kore', gender: '男声', title: '权威男中音', tag: '沉稳睿智' },
        { id: 'Puck', name: 'Puck', gender: '男声', title: '朝气男高音', tag: '活力轻快' },
        { id: 'Fenrir', name: 'Fenrir', gender: '男声', title: '电影级重低音', tag: '磁性厚重' },
        { id: 'Charon', name: 'Charon', gender: '男声', title: '播音级标准音', tag: '专业播报' },
        { id: 'Zephyr', name: 'Zephyr', gender: '女声', title: '知性疗愈女声', tag: '温暖知性' },
      ],
      // 硬性约束 #6：官方精确 ID（如 uncle_fu）来自 Worker 模型运行时；Worker 未就绪时为空数组
      qwen3Tts: (qwenCatalog?.speakers ?? []).map(id => ({ id, name: id })),
    },
    sampleRate: 24000,
    container: 'WAV (RIFF Header, 16-bit PCM)',
  });
});

/** 显式预热本地引擎（P01）：cold/loading → 触发/继续加载；Worker 不可达 → 503 + retry */
voiceModelStatusRouter.post('/engines/:engineId/warmup', async (req, res) => {
  const engine = WARMUP_ENGINES[req.params.engineId];
  if (!engine) {
    return fail(res, 400, `不支持预热该引擎: ${req.params.engineId}（支持: ${Object.keys(WARMUP_ENGINES).join(', ')}）`, 'invalid_request');
  }

  const status = await getWorkerStatus();
  if (!status.reachable) {
    return fail(
      res,
      503,
      '本地 Worker 进程不可达：请先启动 worker/「启动Worker.command」（端口 8800），启动后重试。',
      'engine_unavailable',
      { engine, retry: true }
    );
  }

  try {
    const result = await warmupWorkerEngine(engine);
    return res.json({ engine, state: result.state, error: result.error, retry: result.state !== 'ready' });
  } catch (e: any) {
    return fail(res, 503, `预热请求失败: ${e?.message || e}`, 'engine_unavailable', { engine, retry: true });
  }
});
