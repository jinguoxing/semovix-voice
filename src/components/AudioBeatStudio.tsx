import React, { useState, useEffect, useRef } from 'react';
import { 
  Music, 
  Play, 
  Pause, 
  RotateCcw, 
  Sparkles, 
  Download, 
  FolderPlus, 
  Sliders, 
  RefreshCw, 
  Check, 
  Volume2
} from 'lucide-react';
import { AudioItem, AudioFolder, BeatPattern, SequencerTrack } from '../types/audio';
import { getAudioContext, renderBeatPattern, noteToFreq } from '../utils/audioEngine';
import { getVoiceModelConfig } from '../utils/voiceModelConfig';

interface AudioBeatStudioProps {
  folders: AudioFolder[];
  onSaveToLibrary: (item: AudioItem, blob?: Blob) => void;
  onOpenEditor: (item: AudioItem) => void;
}

export const AudioBeatStudio: React.FC<AudioBeatStudioProps> = ({
  folders,
  onSaveToLibrary,
  onOpenEditor,
}) => {
  const [bpm, setBpm] = useState(96);
  const [patternName, setPatternName] = useState('Lo-Fi 沉浸律动 (Chill Groove)');
  const [scale, setScale] = useState('C Minor');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(folders[2]?.id || folders[0]?.id || '');

  // 5 Tracks
  const [tracks, setTracks] = useState<SequencerTrack[]>([
    {
      id: 't-kick',
      name: '底鼓 (Kick Drum)',
      soundType: 'kick',
      steps: [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false],
      volume: 0.9,
    },
    {
      id: 't-snare',
      name: '军鼓 (Snare / Rim)',
      soundType: 'snare',
      steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
      volume: 0.8,
    },
    {
      id: 't-hihat',
      name: '踩镲 (Hi-Hat)',
      soundType: 'hihat',
      steps: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
      volume: 0.55,
    },
    {
      id: 't-bass',
      name: '低音贝斯 (Sub Bass)',
      soundType: 'bass',
      steps: [true, false, false, false, false, false, true, false, false, false, true, false, false, false, false, false],
      notes: ['C2', null, null, null, null, null, 'Eb2', null, null, null, 'G2', null, null, null, null, null],
      volume: 0.85,
    },
    {
      id: 't-lead',
      name: '合成器主音 (Synth Lead)',
      soundType: 'lead',
      steps: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false],
      notes: ['C4', null, null, 'Eb4', null, null, 'G4', null, null, 'Bb4', null, null, 'C5', null, null, null],
      volume: 0.7,
    },
  ]);

  const [renderedAudio, setRenderedAudio] = useState<{
    audioUrl: string;
    blob: Blob;
    duration: number;
  } | null>(null);

  // Playback timer references
  const timerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  // Real-time audio trigger for step
  const triggerStepSound = (track: SequencerTrack, stepIndex: number) => {
    if (!track.steps[stepIndex]) return;
    const ctx = getAudioContext();
    const time = ctx.currentTime;
    const note = track.notes?.[stepIndex] || null;

    if (track.soundType === 'kick') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);
      gain.gain.setValueAtTime(track.volume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.3);
    } else if (track.soundType === 'snare') {
      const bufferSize = ctx.sampleRate * 0.15;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(900, time);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(track.volume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(time);
      noise.stop(time + 0.15);
    } else if (track.soundType === 'hihat') {
      const bufferSize = ctx.sampleRate * 0.05;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(8000, time);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(track.volume * 0.7, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(time);
      noise.stop(time + 0.05);
    } else if (track.soundType === 'bass') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note ? noteToFreq(note) : 65.41, time);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, time);
      gain.gain.setValueAtTime(track.volume, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.2);
    } else if (track.soundType === 'lead') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(note ? noteToFreq(note) : 261.63, time);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1800, time);
      filter.frequency.exponentialRampToValueAtTime(300, time + 0.2);
      gain.gain.setValueAtTime(track.volume * 0.7, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.25);
    }
  };

  // Clock runner
  useEffect(() => {
    if (isPlaying) {
      getAudioContext();
      const intervalMs = (60 / bpm / 4) * 1000;
      timerRef.current = window.setInterval(() => {
        const step = stepRef.current;
        setCurrentStep(step);
        tracksRef.current.forEach(t => triggerStepSound(t, step));
        stepRef.current = (step + 1) % 16;
      }, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, bpm]);

  const toggleStep = (trackId: string, stepIndex: number) => {
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const newSteps = [...t.steps];
        newSteps[stepIndex] = !newSteps[stepIndex];
        return { ...t, steps: newSteps };
      }
      return t;
    }));
  };

  // AI Beat Pattern Generator with Gemini
  const handleAiGenerateBeat = async (promptStyle: string) => {
    setIsAiGenerating(true);
    try {
      const modelConfig = getVoiceModelConfig();
      const res = await fetch('/api/generate-music-pattern', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: promptStyle, 
          bpm, 
          scale,
          reasoningModel: modelConfig.reasoningModel || 'gemini-2.5-flash',
        }),
      });
      const data = await res.json();
      if (data.pattern) {
        setPatternName(data.pattern.name || promptStyle);
        if (data.pattern.bpm) setBpm(data.pattern.bpm);
        if (data.pattern.scale) setScale(data.pattern.scale);
        if (data.pattern.tracks && data.pattern.tracks.length > 0) {
          setTracks(data.pattern.tracks);
        }
      }
    } catch (e) {
      console.error('Failed to generate pattern', e);
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Render to WAV
  const handleRenderWav = async () => {
    setIsRendering(true);
    try {
      const pattern: BeatPattern = {
        name: patternName,
        bpm,
        scale,
        tracks,
      };
      const result = await renderBeatPattern(pattern, 2);
      const res = await fetch(result.audioUrl);
      const blob = await res.blob();

      setRenderedAudio({
        audioUrl: result.audioUrl,
        blob,
        duration: result.duration,
      });
    } catch (err) {
      console.error('Render error', err);
    } finally {
      setIsRendering(false);
    }
  };

  const handleSaveToLibrary = () => {
    if (!renderedAudio) return;

    const newItem: AudioItem = {
      id: `music-beat-${Date.now()}`,
      title: patternName,
      description: `${bpm} BPM - ${scale} 调式节奏伴奏循环`,
      category: 'music',
      duration: Math.round(renderedAudio.duration * 10) / 10,
      sampleRate: 44100,
      channels: 2,
      format: 'wav',
      fileSize: renderedAudio.blob.size,
      createdAt: new Date().toISOString(),
      tags: ['音乐伴奏', `${bpm}BPM`, scale, '鼓组', '合成器'],
      rating: 5,
      folderId: selectedFolderId || undefined,
      audioUrl: renderedAudio.audioUrl,
      waveformData: [0.8, 0.4, 0.6, 0.9, 0.5, 0.7, 0.9, 0.4, 0.8, 0.5, 0.6, 0.9],
      metadata: {
        bpm,
        key: scale,
        source: 'beat-sequencer',
        isAiGenerated: true,
      },
    };

    onSaveToLibrary(newItem, renderedAudio.blob);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="flex-1 bg-neutral-950 p-6 overflow-y-auto pb-32">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
          <div>
            <div className="flex items-center gap-2">
              <Music className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-bold text-neutral-100">节奏与旋律工坊 (Beat & Sequencer)</h2>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              16步进可视化鼓机与合成器琶音器，支持智能AI律动生成并一键离线渲染为高清 WAV
            </p>
          </div>

          {/* Master Transport Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (isPlaying) {
                  setIsPlaying(false);
                } else {
                  stepRef.current = 0;
                  setIsPlaying(true);
                }
              }}
              className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 shadow-md ${
                isPlaying
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40'
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>停止播放</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>循环试听</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                stepRef.current = 0;
                setCurrentStep(0);
              }}
              className="p-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
              title="重置到第一拍"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Global Controls & AI Presets */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
          
          {/* BPM & Scale */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-400">速度 (BPM):</span>
              <input
                type="range"
                min="60"
                max="160"
                value={bpm}
                onChange={(e) => setBpm(parseInt(e.target.value))}
                className="w-24 accent-emerald-500"
              />
              <span className="font-mono text-xs font-bold text-emerald-400 w-8">{bpm}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-400">调式音阶:</span>
              <select
                value={scale}
                onChange={(e) => setScale(e.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-neutral-200 focus:outline-none"
              >
                <option value="C Minor">C Minor (小调)</option>
                <option value="C Major">C Major (大调)</option>
                <option value="Pentatonic">五声音阶 (Pentatonic)</option>
                <option value="Cyberpunk">赛博朋克音阶 (Cyberpunk)</option>
              </select>
            </div>
          </div>

          {/* AI Style Presets */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>AI 灵感生成:</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Lo-Fi 放松', style: 'Lo-Fi Chill Hop 88BPM' },
                { label: '80s 合成器浪潮', style: '80s Synthwave Retro' },
                { label: '动感 EDM', style: 'Modern EDM Dance Drop' },
                { label: '硬核 Hip-Hop', style: 'Boom Bap 90s Drum Beat' },
              ].map((item) => (
                <button
                  key={item.label}
                  disabled={isAiGenerating}
                  onClick={() => handleAiGenerateBeat(item.style)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-950 border border-neutral-800 text-neutral-300 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* 16-Step Sequencer Grid */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 space-y-3">
          
          {/* Step Timeline Indicator Header */}
          <div className="flex items-center">
            <div className="w-44 shrink-0 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
              轨道 (Tracks)
            </div>
            <div className="flex-1 grid grid-cols-16 gap-1">
              {Array.from({ length: 16 }).map((_, idx) => (
                <div
                  key={idx}
                  className={`text-center font-mono text-[10px] py-0.5 rounded ${
                    currentStep === idx && isPlaying
                      ? 'bg-emerald-500 text-neutral-950 font-bold'
                      : idx % 4 === 0
                      ? 'text-neutral-300 font-semibold'
                      : 'text-neutral-500'
                  }`}
                >
                  {idx + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Tracks Rows */}
          {tracks.map((track) => (
            <div key={track.id} className="flex items-center gap-2 group">
              
              {/* Track Info */}
              <div className="w-44 shrink-0 pr-3">
                <span className="text-xs font-semibold text-neutral-200 block truncate">
                  {track.name}
                </span>
                <span className="text-[10px] text-neutral-400 capitalize">
                  {track.soundType}
                </span>
              </div>

              {/* 16-Step Buttons */}
              <div className="flex-1 grid grid-cols-16 gap-1">
                {track.steps.map((isActive, sIndex) => {
                  const isCurrent = currentStep === sIndex && isPlaying;
                  const isBeatStart = sIndex % 4 === 0;

                  return (
                    <button
                      key={sIndex}
                      onClick={() => toggleStep(track.id, sIndex)}
                      className={`h-9 rounded-lg transition-all relative overflow-hidden ${
                        isActive
                          ? track.soundType === 'kick'
                            ? 'bg-rose-500 shadow-sm shadow-rose-950'
                            : track.soundType === 'snare'
                            ? 'bg-amber-500 shadow-sm shadow-amber-950'
                            : track.soundType === 'hihat'
                            ? 'bg-cyan-500 shadow-sm shadow-cyan-950'
                            : track.soundType === 'bass'
                            ? 'bg-indigo-500 shadow-sm shadow-indigo-950'
                            : 'bg-emerald-500 shadow-sm shadow-emerald-950'
                          : isBeatStart
                          ? 'bg-neutral-800/80 hover:bg-neutral-750 border border-neutral-700/60'
                          : 'bg-neutral-950 hover:bg-neutral-800/60 border border-neutral-850'
                      } ${isCurrent ? 'ring-2 ring-white scale-105' : ''}`}
                    >
                      {/* Step Trigger Glow */}
                      {isActive && (
                        <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                  );
                })}
              </div>

            </div>
          ))}

        </div>

        {/* Render & Export Box */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800">
          <div>
            <h4 className="text-sm font-bold text-neutral-200">离线高保真母带渲染</h4>
            <p className="text-xs text-neutral-400 mt-0.5">
              将当前 16 步进节奏渲染为立体声 44.1kHz 纯净 WAV 文件，用于背景音乐或采样包
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRenderWav}
              disabled={isRendering}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center gap-2 transition-all active:scale-95"
            >
              {isRendering ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在渲染立体声 WAV...</span>
                </>
              ) : (
                <>
                  <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                  <span>渲染完整音频</span>
                </>
              )}
            </button>

            {renderedAudio && (
              <button
                onClick={handleSaveToLibrary}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-950/40 flex items-center gap-1.5 transition-all active:scale-95"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span>已保存至素材库！</span>
                  </>
                ) : (
                  <>
                    <FolderPlus className="w-4 h-4" />
                    <span>保存至素材库</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
