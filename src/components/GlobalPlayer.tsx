import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Volume2, 
  VolumeX, 
  Scissors, 
  Repeat, 
  Radio, 
  Music, 
  Sparkles, 
  Mic, 
  FileAudio,
  FastForward,
  Rewind,
  Activity,
  Waves,
  BarChart3,
  Sliders,
  X,
  Maximize2
} from 'lucide-react';
import { AudioItem } from '../types/audio';
import { getAudioContext } from '../utils/audioEngine';
import { 
  RealtimeWaveformVisualizer, 
  VisualizerMode, 
  VisualizerTheme 
} from './RealtimeWaveformVisualizer';

interface GlobalPlayerProps {
  item: AudioItem | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onOpenEditor: (item: AudioItem) => void;
}

export const GlobalPlayer: React.FC<GlobalPlayerProps> = ({
  item,
  isPlaying,
  onTogglePlay,
  onOpenEditor,
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item?.duration || 0);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Visualizer settings & HUD toggle
  const [isVisualizerHudOpen, setIsVisualizerHudOpen] = useState(false);
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>('waveform');
  const [visualizerTheme, setVisualizerTheme] = useState<VisualizerTheme>('cyan');
  const [visualizerSensitivity, setVisualizerSensitivity] = useState(1.0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [analyserState, setAnalyserState] = useState<AnalyserNode | null>(null);

  // Initialize Web Audio API Analyser graph from HTMLMediaElement
  const initAudioGraph = () => {
    if (!audioRef.current) return;
    try {
      const ctx = getAudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (!sourceNodeRef.current) {
        const source = ctx.createMediaElementSource(audioRef.current);
        sourceNodeRef.current = source;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.82;
        analyserRef.current = analyser;

        source.connect(analyser);
        analyser.connect(ctx.destination);
        setAnalyserState(analyser);
      }
    } catch (err) {
      console.warn('Web Audio API graph setup warning:', err);
    }
  };

  // Sync audio src when item changes
  useEffect(() => {
    if (!item) return;
    if (audioRef.current) {
      audioRef.current.src = item.audioUrl;
      audioRef.current.load();
      if (isPlaying) {
        initAudioGraph();
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        }
        audioRef.current.play().catch(e => console.warn('Autoplay error', e));
      }
    }
  }, [item?.id, item?.audioUrl]);

  // Sync play/pause state
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      initAudioGraph();
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      audioRef.current.play().catch(e => console.warn('Play error', e));
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  // Update volume and mute
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  // Update speed
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Update loop
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.loop = isLooping;
  }, [isLooping]);

  if (!item) return null;

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
        setDuration(audioRef.current.duration);
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const handleRewind5 = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
    }
  };

  const handleForward5 = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5);
    }
  };

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'speech': return Radio;
      case 'sfx': return Sparkles;
      case 'music': return Music;
      case 'recording': return Mic;
      default: return FileAudio;
    }
  };

  const CategoryIcon = getCategoryIcon(item.category);

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-neutral-900/95 backdrop-blur-xl border-t border-neutral-800 px-4 py-2.5 shadow-2xl">
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          if (!isLooping) {
            onTogglePlay();
          }
        }}
      />

      {/* Expanded Studio Visualizer HUD Panel */}
      {isVisualizerHudOpen && (
        <div className="absolute bottom-full mb-3 inset-x-4 max-w-4xl mx-auto bg-neutral-900/95 backdrop-blur-2xl border border-neutral-700/80 rounded-2xl p-4 shadow-2xl z-50">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Activity className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-neutral-100 flex items-center gap-2">
                  <span>实时音频示波视窗 (Web Audio Oscilloscope)</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 bg-neutral-800 text-cyan-400 rounded border border-neutral-700">
                    512 FFT • 60 FPS
                  </span>
                </h3>
                <p className="text-[10px] text-neutral-400">
                  当前轨道: {item.title} • {item.format.toUpperCase()} • 实时声学反馈
                </p>
              </div>
            </div>

            {/* Visualizer Controls */}
            <div className="flex items-center gap-2">
              {/* Mode Selectors */}
              <div className="flex items-center gap-0.5 bg-neutral-950 p-1 rounded-lg border border-neutral-800 text-xs">
                <button
                  onClick={() => setVisualizerMode('waveform')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    visualizerMode === 'waveform' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Waves className="w-3 h-3" />
                  <span>波形</span>
                </button>
                <button
                  onClick={() => setVisualizerMode('spectrum')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    visualizerMode === 'spectrum' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <BarChart3 className="w-3 h-3" />
                  <span>频谱</span>
                </button>
                <button
                  onClick={() => setVisualizerMode('aurora')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    visualizerMode === 'aurora' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>极光</span>
                </button>
              </div>

              {/* Theme Selector */}
              <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
                {(['cyan', 'violet', 'emerald'] as VisualizerTheme[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setVisualizerTheme(t)}
                    className={`w-4 h-4 rounded-full transition-transform ${
                      t === 'cyan' ? 'bg-cyan-400' : t === 'violet' ? 'bg-purple-500' : 'bg-emerald-400'
                    } ${visualizerTheme === t ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
                    title={`主题: ${t}`}
                  />
                ))}
              </div>

              {/* Sensitivity Selector */}
              <div className="flex items-center gap-1 bg-neutral-950 px-2 py-1 rounded-lg border border-neutral-800 text-[10px] text-neutral-400 font-mono">
                <Sliders className="w-3 h-3 text-neutral-500" />
                <span>增益:</span>
                {[1.0, 1.5, 2.0].map((s) => (
                  <button
                    key={s}
                    onClick={() => setVisualizerSensitivity(s)}
                    className={`px-1 py-0.5 rounded ${
                      visualizerSensitivity === s ? 'text-cyan-400 font-bold bg-neutral-800' : 'hover:text-neutral-200'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>

              {/* Close HUD */}
              <button
                onClick={() => setIsVisualizerHudOpen(false)}
                className="p-1 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors ml-1"
                title="关闭示波面板"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Large Waveform Canvas */}
          <div className="p-2.5 bg-neutral-950/80 rounded-xl border border-neutral-800/80">
            <RealtimeWaveformVisualizer
              analyser={analyserState}
              isPlaying={isPlaying}
              mode={visualizerMode}
              theme={visualizerTheme}
              height={120}
              sensitivity={visualizerSensitivity}
              showVuMeter={true}
              className="w-full"
            />
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        
        {/* Left: Track Info */}
        <div className="flex items-center gap-3 min-w-0 w-1/4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-md">
            <CategoryIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h4 className="font-semibold text-xs text-neutral-100 truncate" title={item.title}>
              {item.title}
            </h4>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
              <span className="capitalize">{item.category}</span>
              <span>•</span>
              <span className="font-mono">{item.format.toUpperCase()}</span>
            </div>
          </div>
        </div>

        {/* Center: Controls, Scrubber & Real-time Waveform Strip */}
        <div className="flex-1 max-w-xl flex flex-col items-center gap-1.5">
          
          {/* Action buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsLooping(!isLooping)}
              className={`p-1.5 rounded-lg transition-colors ${
                isLooping ? 'text-cyan-400 bg-cyan-950/40' : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="循环播放"
            >
              <Repeat className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={handleRewind5}
              className="text-neutral-400 hover:text-neutral-200 p-1"
              title="快退 5 秒"
            >
              <Rewind className="w-4 h-4" />
            </button>

            <button
              onClick={onTogglePlay}
              className="w-9 h-9 rounded-full bg-cyan-500 hover:bg-cyan-400 text-neutral-950 flex items-center justify-center font-bold shadow-lg shadow-cyan-500/20 transition-transform active:scale-95"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            <button
              onClick={handleForward5}
              className="text-neutral-400 hover:text-neutral-200 p-1"
              title="快进 5 秒"
            >
              <FastForward className="w-4 h-4" />
            </button>

            {/* Speed Selector */}
            <div className="flex items-center gap-0.5 text-[10px] font-mono bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
              {[1.0, 1.25, 1.5].map(s => (
                <button
                  key={s}
                  onClick={() => setPlaybackSpeed(s)}
                  className={`px-1 py-0.5 rounded ${playbackSpeed === s ? 'text-cyan-400 font-bold' : 'text-neutral-500'}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* Integrated Inline Real-Time Waveform Strip */}
          <div className="w-full relative h-6 bg-neutral-950/70 border border-neutral-800/80 rounded px-2 py-0.5 flex items-center overflow-hidden">
            <RealtimeWaveformVisualizer
              analyser={analyserState}
              isPlaying={isPlaying}
              mode={visualizerMode}
              theme={visualizerTheme}
              height={20}
              sensitivity={visualizerSensitivity}
              className="w-full"
            />
            {isPlaying && (
              <span className="absolute right-2 top-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
              </span>
            )}
          </div>

          {/* Scrubber progress */}
          <div className="w-full flex items-center gap-3">
            <span className="text-[10px] font-mono text-neutral-400 w-8 text-right">
              {formatTime(currentTime)}
            </span>

            <input
              type="range"
              min="0"
              max={duration || 1}
              step="0.05"
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 accent-cyan-500 h-1 bg-neutral-800 rounded-lg cursor-pointer"
            />

            <span className="text-[10px] font-mono text-neutral-400 w-8">
              {formatTime(duration)}
            </span>
          </div>

        </div>

        {/* Right: Volume, Visualizer HUD Toggle & Editor Trigger */}
        <div className="flex items-center justify-end gap-3 w-1/4">
          
          {/* Visualizer HUD Trigger Button */}
          <button
            onClick={() => {
              initAudioGraph();
              setIsVisualizerHudOpen(!isVisualizerHudOpen);
            }}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              isVisualizerHudOpen
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                : 'bg-neutral-800/90 border-neutral-700/80 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600'
            }`}
            title="展开/收起 实时音频示波器"
          >
            <Activity className={`w-3.5 h-3.5 ${isPlaying ? 'text-cyan-400 animate-pulse' : ''}`} />
            <span className="hidden xl:inline text-[11px]">示波器</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="text-neutral-400 hover:text-neutral-200"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                setVolume(parseFloat(e.target.value));
                setIsMuted(false);
              }}
              className="w-14 sm:w-16 accent-cyan-500 h-1 bg-neutral-800 rounded-lg"
            />
          </div>

          <button
            onClick={() => onOpenEditor(item)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-cyan-300 transition-colors shrink-0"
            title="在波形编辑器中微调裁剪"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">剪辑调音</span>
          </button>
        </div>

      </div>
    </div>
  );
};

