/**
 * 音色目录 + 引擎冷启动状态 Hook（P01）
 *
 * - gemini：静态官方 5 音色（无需引擎）
 * - qwen3Tts：/api/voice-model/status 拉取 Worker 运行时官方目录（硬性约束 #6）；
 *   引擎 cold/loading 时自动 POST /api/engines/qwen_tts/warmup 并每 2s 轮询，
 *   ready 瞬间刷新目录；error 如实暴露真实原因，绝无伪造的“已连接”。
 * - webSpeech：浏览器 speechSynthesis 系统音色
 * 另导出 useWorkerEngine('whisper_asr')：转录弹窗等处的引擎状态/预热复用。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceProvider } from '../types/audio';
import { AVAILABLE_VOICES } from '../utils/voiceModelConfig';
import type { ProviderVoiceEntry } from '../utils/voiceProvider';

export type EngineRuntimeState = 'cold' | 'loading' | 'ready' | 'error' | 'unreachable';

export interface VoiceCatalogApi {
  voices: ProviderVoiceEntry[];
  /** 当前 provider 对应引擎的运行时状态（gemini/webSpeech 恒为 ready 或 cold） */
  engineState: EngineRuntimeState;
  /** engineState === 'error' 或 Worker 不可达时的真实原因 */
  error: string | null;
  loading: boolean;
  /** 手动刷新目录/状态 */
  refresh: () => void;
  /** 手动触发预热（服务端幂等；error 后重试即重新加载） */
  warmup: () => Promise<void>;
  warming: boolean;
}

const GEMINI_CATALOG: ProviderVoiceEntry[] = AVAILABLE_VOICES.map(v => ({
  id: v.id,
  name: v.name,
  tag: v.tag,
  desc: v.desc,
  gender: v.gender,
  previewPrompt: v.previewPrompt,
}));

const QWEN_PREVIEW = '你好，我是本地的 Qwen3 语音，正在为你朗读这段试听样音。';

interface StatusResponse {
  engines?: Array<{ id: string; reachable: boolean; state: string; error: string | null }>;
  voices?: { qwen3Tts?: Array<{ id: string; name: string }> };
}

async function fetchQwenStatus(): Promise<{ state: EngineRuntimeState; error: string | null; voices: ProviderVoiceEntry[] }> {
  try {
    const res = await fetch('/api/voice-model/status');
    if (!res.ok) return { state: 'unreachable', error: `状态接口不可用（HTTP ${res.status}）`, voices: [] };
    const data = (await res.json()) as StatusResponse;
    const engine = data.engines?.find(e => e.id === 'qwen3-tts-local');
    const voices = (data.voices?.qwen3Tts ?? []).map(v => ({
      id: v.id,
      name: v.name,
      tag: '官方 ID',
      desc: 'Qwen3-TTS 官方音色（来自引擎运行时目录，ID 精确匹配）',
      gender: '官方',
      previewPrompt: QWEN_PREVIEW,
    }));
    if (!engine) return { state: 'unreachable', error: '状态接口未上报 qwen3-tts-local 引擎', voices };
    if (!engine.reachable) return { state: 'unreachable', error: 'Worker 进程不可达：请先启动 worker/「启动Worker.command」（端口 8800）', voices };
    const state = (['cold', 'loading', 'ready', 'error'] as const).includes(engine.state as any)
      ? (engine.state as EngineRuntimeState)
      : 'cold';
    return { state, error: engine.error ?? null, voices };
  } catch (e: any) {
    return { state: 'unreachable', error: e?.message || '网络错误', voices: [] };
  }
}

/** 通用 Worker 引擎状态（qwen_tts / whisper_asr）：自动预热 + 2s 轮询直至 ready/error */
export function useWorkerEngine(engineId: 'qwen_tts' | 'whisper_asr', autoWarmup = true) {
  const [state, setState] = useState<EngineRuntimeState>('cold');
  const [error, setError] = useState<string | null>(null);
  const [warming, setWarming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);

  const poll = useCallback(async () => {
    // 复用 qwen 状态接口：whisper_asr 状态同样在 engines 数组里（id: whisper-local）
    try {
      const res = await fetch('/api/voice-model/status');
      if (!res.ok) {
        setState('unreachable');
        setError(`状态接口不可用（HTTP ${res.status}）`);
        return;
      }
      const data = (await res.json()) as StatusResponse;
      const engineIdForApi = engineId === 'qwen_tts' ? 'qwen3-tts-local' : 'whisper-local';
      const engine = data.engines?.find(e => e.id === engineIdForApi);
      if (!engine) {
        setState('unreachable');
        setError('状态接口未上报该引擎');
        return;
      }
      if (!engine.reachable) {
        setState('unreachable');
        setError('Worker 进程不可达：请先启动 worker/「启动Worker.command」（端口 8800）');
        return;
      }
      setState((['cold', 'loading', 'ready', 'error'] as const).includes(engine.state as any) ? (engine.state as EngineRuntimeState) : 'cold');
      setError(engine.error ?? null);
    } catch (e: any) {
      setState('unreachable');
      setError(e?.message || '网络错误');
    }
  }, [engineId]);

  const warmup = useCallback(async () => {
    setWarming(true);
    try {
      await fetch(`/api/engines/${engineId}/warmup`, { method: 'POST' });
    } catch {
      /* 网络失败：轮询兜底 */
    } finally {
      setWarming(false);
    }
    await poll();
  }, [engineId, poll]);

  useEffect(() => {
    aliveRef.current = true;
    void poll();
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  // cold → 自动预热；cold/loading → 2s 轮询；ready/error → 停止轮询（error 可手动 warmup 重试）
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (state === 'cold' && autoWarmup) {
      void warmup();
    }
    if (state === 'cold' || state === 'loading') {
      timerRef.current = setInterval(() => {
        if (aliveRef.current) void poll();
      }, 2000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state, autoWarmup, warmup, poll]);

  return { state, error, warmup, warming, refresh: poll };
}

export function useVoiceCatalog(provider: VoiceProvider): VoiceCatalogApi {
  const worker = useWorkerEngine('qwen_tts', provider === 'qwen3Tts');
  const [qwenVoices, setQwenVoices] = useState<ProviderVoiceEntry[]>([]);
  const [webVoices, setWebVoices] = useState<ProviderVoiceEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Qwen：状态就绪时拉目录（ready 瞬间服务端已绕过缓存 TTL）
  useEffect(() => {
    if (provider !== 'qwen3Tts') return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { voices } = await fetchQwenStatus();
      if (!cancelled) setQwenVoices(voices);
      if (!cancelled) setLoading(false);
    };
    void load();
    if (worker.state === 'ready') {
      // 目录与状态同一响应，这里主要用于 ready 后的再刷新
      const t = setTimeout(load, 50);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [provider, worker.state]);

  // WebSpeech：系统音色（异步加载）
  useEffect(() => {
    if (provider !== 'webSpeech') return;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return;
    const read = () => {
      const list = synth.getVoices().filter(v => v.lang.startsWith('zh') || v.lang.startsWith('en'));
      setWebVoices(
        (list.length ? list : synth.getVoices()).map(v => ({
          id: v.voiceURI,
          name: v.name,
          tag: v.lang,
          desc: `${v.name}（${v.lang}）· 浏览器系统音色，仅供实时预览`,
          gender: v.localService ? '本地' : '云端',
        }))
      );
    };
    read();
    synth.addEventListener?.('voiceschanged', read);
    return () => synth.removeEventListener?.('voiceschanged', read);
  }, [provider]);

  return useMemo(() => {
    if (provider === 'gemini') {
      return { voices: GEMINI_CATALOG, engineState: 'ready' as EngineRuntimeState, error: null, loading: false, refresh: () => {}, warmup: async () => {}, warming: false };
    }
    if (provider === 'webSpeech') {
      return {
        voices: webVoices,
        engineState: (webVoices.length ? 'ready' : 'cold') as EngineRuntimeState,
        error: webVoices.length ? null : '当前浏览器未暴露系统音色（仅部分环境支持）',
        loading: false,
        refresh: () => {},
        warmup: async () => {},
        warming: false,
      };
    }
    return {
      voices: qwenVoices,
      engineState: worker.state,
      error: worker.error,
      loading,
      refresh: () => void worker.refresh(),
      warmup: worker.warmup,
      warming: worker.warming,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, qwenVoices, webVoices, worker.state, worker.error, worker.warming, loading]);
}
