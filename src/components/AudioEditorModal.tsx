import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Play, 
  Pause, 
  Scissors, 
  RotateCcw, 
  Download, 
  Save, 
  Sliders, 
  Sparkles, 
  Volume2, 
  Check, 
  RefreshCw 
} from 'lucide-react';
import { AudioItem, AudioEditSettings } from '../types/audio';
import { getAudioContext, processAudio, extractPeaks } from '../utils/audioEngine';

interface AudioEditorModalProps {
  item: AudioItem;
  onClose: () => void;
  onSaveAsNew: (newItem: AudioItem, blob: Blob) => void;
  onOverwrite: (id: string, updates: Partial<AudioItem>, blob?: Blob) => void;
}

export const AudioEditorModal: React.FC<AudioEditorModalProps> = ({
  item,
  onClose,
  onSaveAsNew,
  onOverwrite,
}) => {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [loadingBuffer, setLoadingBuffer] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Edit settings
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(item.duration);
  const [fadeIn, setFadeIn] = useState(0.05);
  const [fadeOut, setFadeOut] = useState(0.1);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [gainDb, setGainDb] = useState(0);
  const [eqLow, setEqLow] = useState(0);
  const [eqMid, setEqMid] = useState(0);
  const [eqHigh, setEqHigh] = useState(0);
  const [reverb, setReverb] = useState(0.1);
  const [normalize, setNormalize] = useState(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<'trim' | 'fx'>('trim');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Load and decode AudioBuffer from item.audioUrl
  useEffect(() => {
    let isCancelled = false;
    async function decode() {
      try {
        setLoadingBuffer(true);
        const res = await fetch(item.audioUrl);
        const arrayBuffer = await res.arrayBuffer();
        const ctx = getAudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        if (!isCancelled) {
          setAudioBuffer(decoded);
          setStartTime(0);
          setEndTime(decoded.duration);
          const extracted = extractPeaks(decoded, 120);
          setPeaks(extracted);
        }
      } catch (err) {
        console.error('Failed to decode audio', err);
      } finally {
        if (!isCancelled) setLoadingBuffer(false);
      }
    }
    decode();
    return () => {
      isCancelled = true;
      stopAudio();
    };
  }, [item.audioUrl]);

  // Waveform Canvas Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0 || !audioBuffer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const totalDur = audioBuffer.duration;
    const startX = (startTime / totalDur) * width;
    const endX = (endTime / totalDur) * width;
    const currentX = (currentTime / totalDur) * width;

    // Draw unselected dim background
    ctx.fillStyle = 'rgba(23, 23, 23, 0.8)';
    ctx.fillRect(0, 0, width, height);

    // Draw active trim highlight area
    ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
    ctx.fillRect(startX, 0, endX - startX, height);

    // Draw waveform bars
    const barWidth = width / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth;
      const barH = peaks[i] * (height * 0.85);
      const y = (height - barH) / 2;

      if (x >= startX && x <= endX) {
        // Inside selected trim range
        ctx.fillStyle = x <= currentX && isPlaying ? '#22d3ee' : '#0891b2';
      } else {
        ctx.fillStyle = '#3f3f46';
      }

      ctx.beginPath();
      ctx.roundRect(x + 1, y, Math.max(1.5, barWidth - 1.5), barH, 2);
      ctx.fill();
    }

    // Draw start handle
    ctx.fillStyle = '#06b6d4';
    ctx.fillRect(startX - 2, 0, 4, height);

    // Draw end handle
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(endX - 2, 0, 4, height);

    // Draw playhead cursor
    if (isPlaying) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(currentX - 1, 0, 2, height);
    }
  }, [peaks, startTime, endTime, currentTime, isPlaying, audioBuffer]);

  // Audio Playback
  const playPreview = () => {
    if (!audioBuffer) return;
    stopAudio();

    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;

    // Connect to master
    source.connect(ctx.destination);

    const playStart = startTime;
    const playDuration = Math.max(0.05, endTime - startTime);

    source.start(0, playStart, playDuration);
    activeSourceRef.current = source;
    startTimeRef.current = ctx.currentTime - playStart;
    setIsPlaying(true);

    source.onended = () => {
      setIsPlaying(false);
      setCurrentTime(startTime);
    };

    // Tracking loop
    const trackProgress = () => {
      if (!activeSourceRef.current) return;
      const elapsed = (ctx.currentTime - startTimeRef.current) * playbackRate;
      setCurrentTime(elapsed);
      if (elapsed < endTime) {
        animFrameRef.current = requestAnimationFrame(trackProgress);
      }
    };
    animFrameRef.current = requestAnimationFrame(trackProgress);
  };

  const stopAudio = () => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch {}
      activeSourceRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleApplyDSP = async (): Promise<{ audioUrl: string; duration: number; blob: Blob } | null> => {
    if (!audioBuffer) return null;
    setIsProcessing(true);
    try {
      const settings: AudioEditSettings = {
        startTime,
        endTime,
        fadeIn,
        fadeOut,
        playbackRate,
        gain: gainDb,
        eq: { low: eqLow, mid: eqMid, high: eqHigh },
        reverb,
        delay: { enabled: false, time: 0.2, feedback: 0.3 },
        normalize,
      };

      const result = await processAudio(audioBuffer, settings);
      const res = await fetch(result.audioUrl);
      const blob = await res.blob();
      return { audioUrl: result.audioUrl, duration: result.duration, blob };
    } catch (err) {
      console.error('DSP process error', err);
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveAsNewItem = async () => {
    const res = await handleApplyDSP();
    if (!res) return;

    const newItem: AudioItem = {
      ...item,
      id: `audio-edit-${Date.now()}`,
      title: `${item.title} (已调音)`,
      duration: Math.round(res.duration * 100) / 100,
      audioUrl: res.audioUrl,
      fileSize: res.blob.size,
      createdAt: new Date().toISOString(),
      metadata: {
        ...item.metadata,
        source: 'edited',
      },
    };

    onSaveAsNew(newItem, res.blob);
    onClose();
  };

  const handleOverwriteItem = async () => {
    if (!confirm(`确定覆盖当前素材 "${item.title}" 吗？此操作无法撤销。`)) return;
    const res = await handleApplyDSP();
    if (!res) return;

    onOverwrite(
      item.id,
      {
        duration: Math.round(res.duration * 100) / 100,
        audioUrl: res.audioUrl,
        fileSize: res.blob.size,
      },
      res.blob
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-fadeIn">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold">
              <Scissors className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-100 flex items-center gap-2">
                <span>音频波形编辑与调音台</span>
                <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono font-normal">
                  {item.title}
                </span>
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* Waveform Canvas View */}
          <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-neutral-400">
              <span className="flex items-center gap-1 font-semibold text-neutral-300">
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>交互波形预览 (拖动两端滑杆精确裁剪)</span>
              </span>
              <span className="font-mono text-cyan-400">
                裁剪片段: {Math.max(0, (endTime - startTime)).toFixed(2)}s / 原始时长: {item.duration.toFixed(2)}s
              </span>
            </div>

            <div className="relative">
              <canvas
                ref={canvasRef}
                width={800}
                height={120}
                className="w-full h-28 rounded-xl bg-neutral-950 block cursor-crosshair"
              />
            </div>

            {/* Start and End Sliders */}
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span className="text-cyan-400 font-semibold">起点 (Start):</span>
                  <span className="font-mono text-neutral-200">{startTime.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={audioBuffer?.duration || 10}
                  step="0.05"
                  value={startTime}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (val < endTime - 0.1) setStartTime(val);
                  }}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span className="text-rose-400 font-semibold">终点 (End):</span>
                  <span className="font-mono text-neutral-200">{endTime.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={audioBuffer?.duration || 10}
                  step="0.05"
                  value={endTime}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (val > startTime + 0.1) setEndTime(val);
                  }}
                  className="w-full accent-rose-500"
                />
              </div>
            </div>

            {/* Play/Pause Scrubber */}
            <div className="flex items-center justify-between pt-2 border-t border-neutral-900">
              <button
                onClick={() => {
                  if (isPlaying) stopAudio();
                  else playPreview();
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                  isPlaying
                    ? 'bg-rose-500 text-white'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-950/40'
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>停止预览</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>试听裁剪区间</span>
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  setStartTime(0);
                  if (audioBuffer) setEndTime(audioBuffer.duration);
                }}
                className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>重置选区</span>
              </button>
            </div>
          </div>

          {/* Tab Selection */}
          <div className="flex border-b border-neutral-800">
            <button
              onClick={() => setActiveTab('trim')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'trim'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              淡入淡出与倍速
            </button>
            <button
              onClick={() => setActiveTab('fx')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'fx'
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              3段均衡器 (EQ) 与混响空间
            </button>
          </div>

          {/* Sub Panels */}
          {activeTab === 'trim' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              
              {/* Fade In */}
              <div className="bg-neutral-950/60 border border-neutral-800 p-3.5 rounded-xl space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-300 font-medium">淡入时长 (Fade In)</span>
                  <span className="font-mono text-cyan-400">{fadeIn}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.0"
                  step="0.05"
                  value={fadeIn}
                  onChange={(e) => setFadeIn(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              {/* Fade Out */}
              <div className="bg-neutral-950/60 border border-neutral-800 p-3.5 rounded-xl space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-300 font-medium">淡出时长 (Fade Out)</span>
                  <span className="font-mono text-cyan-400">{fadeOut}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.0"
                  step="0.05"
                  value={fadeOut}
                  onChange={(e) => setFadeOut(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              {/* Playback Rate / Speed */}
              <div className="bg-neutral-950/60 border border-neutral-800 p-3.5 rounded-xl space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-300 font-medium">播放速率 (Speed)</span>
                  <span className="font-mono text-cyan-400">{playbackRate}x</span>
                </div>
                <div className="flex gap-1">
                  {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => setPlaybackRate(rate)}
                      className={`flex-1 py-1 rounded text-[11px] font-mono font-medium ${
                        playbackRate === rate ? 'bg-cyan-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>

            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              
              {/* EQ Low */}
              <div className="bg-neutral-950/60 border border-neutral-800 p-3.5 rounded-xl space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-300 font-medium">低音 (Low Bass)</span>
                  <span className="font-mono text-cyan-400">{eqLow}dB</span>
                </div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={eqLow}
                  onChange={(e) => setEqLow(parseInt(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              {/* EQ Mid */}
              <div className="bg-neutral-950/60 border border-neutral-800 p-3.5 rounded-xl space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-300 font-medium">中音 (Mid Vocal)</span>
                  <span className="font-mono text-cyan-400">{eqMid}dB</span>
                </div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={eqMid}
                  onChange={(e) => setEqMid(parseInt(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              {/* EQ High */}
              <div className="bg-neutral-950/60 border border-neutral-800 p-3.5 rounded-xl space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-300 font-medium">高音 (Treble)</span>
                  <span className="font-mono text-cyan-400">{eqHigh}dB</span>
                </div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={eqHigh}
                  onChange={(e) => setEqHigh(parseInt(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              {/* Reverb Space */}
              <div className="bg-neutral-950/60 border border-neutral-800 p-3.5 rounded-xl space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-300 font-medium">空间混响 (Reverb)</span>
                  <span className="font-mono text-cyan-400">{Math.round(reverb * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.05"
                  value={reverb}
                  onChange={(e) => setReverb(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

            </div>
          )}

          {/* Normalization Checkbox */}
          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="normalize-chk"
              checked={normalize}
              onChange={(e) => setNormalize(e.target.checked)}
              className="accent-cyan-500 rounded"
            />
            <label htmlFor="normalize-chk" className="text-xs text-neutral-300 font-medium cursor-pointer">
              自动声压标准化 (Audio Normalization) - 提升整体动态与清晰度，消除爆音与电平过低
            </label>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-neutral-800 bg-neutral-900/90 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            取消退出
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={handleOverwriteItem}
              disabled={isProcessing}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 transition-colors"
            >
              覆盖原素材
            </button>

            <button
              onClick={handleSaveAsNewItem}
              disabled={isProcessing}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-950/40 flex items-center gap-2 transition-all active:scale-95"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>处理渲染中...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>另存为新版本</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
