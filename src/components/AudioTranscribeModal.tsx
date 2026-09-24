import React, { useState } from 'react';
import {
  X,
  FileText,
  Sparkles,
  Check,
  RefreshCw,
  Smile,
  Tag,
  Copy,
  Save,
  AlertTriangle
} from 'lucide-react';
import { AudioItem } from '../types/audio';
import { getVoiceModelConfig } from '../utils/voiceModelConfig';
import { useWorkerEngine } from '../hooks/useVoiceCatalog';

interface AudioTranscribeModalProps {
  item: AudioItem;
  onClose: () => void;
  onUpdateItem: (id: string, updates: Partial<AudioItem>) => void;
}

export const AudioTranscribeModal: React.FC<AudioTranscribeModalProps> = ({
  item,
  onClose,
  onUpdateItem,
}) => {
  const modelConfig = getVoiceModelConfig();
  // P01 冷启动：whisper-local 时展示引擎真实状态（自动预热 + 2s 轮询），不伪造就绪
  const isWhisperLocal = modelConfig.transcribeModel === 'whisper-local';
  const whisper = useWorkerEngine('whisper_asr', isWhisperLocal);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState(item.transcript || '');
  const [summary, setSummary] = useState('');
  const [mood, setMood] = useState('');
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  // 诚实失败（硬性约束 #3）：引擎失败时展示真实原因，不再写入模拟转录文本
  const [error, setError] = useState<string | null>(null);

  const handleTranscribe = async () => {
    setIsTranscribing(true);
    setError(null);
    try {
      const response = await fetch(item.audioUrl);
      if (!response.ok) throw new Error(`音频读取失败（HTTP ${response.status}）`);
      const blob = await response.blob();

      // P4：multipart 文件上传（硬性约束 #7：大音频不得 JSON Base64 传输）
      const form = new FormData();
      form.append('audio', blob, `${item.id}.${item.format || 'wav'}`);
      form.append('transcribeModel', modelConfig.transcribeModel || 'gemini-2.5-flash');

      const res = await fetch('/api/transcribe-audio', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok && data.success && data.transcript) {
        setTranscript(data.transcript);
        setSummary(data.summary || '');
        setMood(data.mood || '清晰自然');
        setSuggestedTags(data.tags || ['人声', '清晰']);
      } else {
        // 引擎不可用/失败：如实展示服务端错误，不落任何模拟文字稿
        setError(data.error || `转录失败（HTTP ${res.status}${data.code ? ` · ${data.code}` : ''}）。`);
      }
    } catch (e: any) {
      console.error('Transcription request failed:', e);
      setError(`转录请求失败：${e?.message || '网络错误'}。请确认引擎服务已启动。`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyToItem = () => {
    const updatedTags = Array.from(new Set([...item.tags, ...suggestedTags]));
    onUpdateItem(item.id, {
      transcript,
      tags: updatedTags,
      description: summary || item.description,
    });
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-neutral-100">AI 语音转录与情绪分析</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {modelConfig.transcribeModel || 'gemini-2.5-flash'}
                </span>
              </div>
              <span className="text-xs text-neutral-400 font-mono">{item.title}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Whisper 引擎冷启动状态条（P01）：cold/loading 如实展示并自动预热；不伪造就绪 */}
        {isWhisperLocal && whisper.state !== 'ready' && (
          <div className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs ${
            whisper.state === 'error'
              ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
              : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              {(whisper.state === 'cold' || whisper.state === 'loading' || whisper.warming) ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="font-semibold">
                Whisper 引擎{whisper.state === 'unreachable' ? '不可达' : whisper.state === 'error' ? '加载失败' : '加载中'}：
              </span>
              <span className="truncate text-neutral-300" title={whisper.error ?? undefined}>
                {whisper.state === 'unreachable'
                  ? '请先启动 worker/「启动Worker.command」（端口 8800）'
                  : whisper.state === 'error'
                    ? (whisper.error || '未知错误，请查看 Worker 日志')
                    : whisper.state === 'cold'
                      ? '模型未加载，正在触发预热…'
                      : '首次加载约需 30-90 秒，就绪后即可转录'}
              </span>
            </div>
            <button
              onClick={() => void whisper.warmup()}
              disabled={whisper.warming}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[11px] font-semibold disabled:opacity-50 shrink-0"
            >
              {whisper.warming ? '预热中…' : whisper.state === 'error' ? '重试预热' : '立即预热'}
            </button>
          </div>
        )}

        {/* Honest Failure View：真实失败原因 + 重试（硬性约束 #3） */}
        {error && !isTranscribing ? (
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-rose-200">转录失败</p>
            <p className="text-xs text-neutral-400 max-w-sm mx-auto break-words">{error}</p>
            <p className="text-[11px] text-neutral-500">
              提示：本地转录需先启动 Python FastAPI Worker（worker/「启动Worker.command」）；云端转录需在配置中填写 Gemini API key。
            </p>
            <button
              onClick={handleTranscribe}
              className="px-6 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/50 flex items-center gap-2 mx-auto transition-all active:scale-95"
            >
              <RefreshCw className="w-4 h-4" />
              <span>重试转录</span>
            </button>
          </div>
        ) : !transcript && !isTranscribing ? (
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <p className="text-sm font-semibold text-neutral-200">
              {isWhisperLocal ? '使用本地 Whisper large-v3-turbo 提取音频逐字稿' : '使用 Gemini 语音大模型提取音频逐字稿'}
            </p>
            <p className="text-xs text-neutral-400 max-w-sm mx-auto">
              {isWhisperLocal && whisper.state !== 'ready'
                ? '引擎预热完成前点击转录会等待模型加载（首次约 30-90 秒）'
                : '自动识别语言文字、检测说话者情绪张力并智能推荐相关检索标签'}
            </p>
            <button
              onClick={handleTranscribe}
              className="px-6 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/50 flex items-center gap-2 mx-auto transition-all active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              <span>开始智能识别转录</span>
            </button>
          </div>
        ) : isTranscribing ? (
          <div className="text-center py-10 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mx-auto" />
            <p className="text-sm font-semibold text-neutral-200">正在分析音频语谱并转换文字...</p>
            <p className="text-xs text-neutral-500">模型运算中，请稍候几秒钟</p>
          </div>
        ) : (
          <div className="space-y-4">
            
            {/* Transcript text box */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-neutral-300">转录文本 (Transcript)</span>
                <button
                  onClick={handleCopy}
                  className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copied ? '已复制！' : '复制文本'}</span>
                </button>
              </div>
              <textarea
                rows={4}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-neutral-100 focus:outline-none focus:border-indigo-500 leading-relaxed"
              />
            </div>

            {/* Analysis Grid */}
            <div className="grid grid-cols-2 gap-3">
              {mood && (
                <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3">
                  <span className="text-[11px] text-neutral-400 flex items-center gap-1 mb-1">
                    <Smile className="w-3.5 h-3.5 text-amber-400" />
                    <span>检测情绪/声调</span>
                  </span>
                  <span className="text-xs font-semibold text-neutral-200">{mood}</span>
                </div>
              )}

              {suggestedTags.length > 0 && (
                <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-3">
                  <span className="text-[11px] text-neutral-400 flex items-center gap-1 mb-1">
                    <Tag className="w-3.5 h-3.5 text-cyan-400" />
                    <span>推荐标签</span>
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {suggestedTags.map(t => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Apply */}
            <div className="flex justify-between items-center pt-3 border-t border-neutral-800">
              <button
                onClick={handleTranscribe}
                className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>重新转录</span>
              </button>

              <button
                onClick={handleApplyToItem}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/40 flex items-center gap-1.5 transition-all active:scale-95"
              >
                {savedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                    <span>已应用至素材信息！</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>保存转录至素材</span>
                  </>
                )}
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
