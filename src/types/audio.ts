/**
 * AudioCraft Studio - Core Types
 */

export type AudioCategory = 'speech' | 'sfx' | 'music' | 'recording' | 'sample';

export interface AudioItem {
  id: string;
  title: string;
  description?: string;
  category: AudioCategory;
  duration: number; // in seconds
  sampleRate: number; // e.g. 44100, 48000, 24000
  channels: number; // 1 or 2
  format: 'wav' | 'mp3' | 'webm' | 'ogg';
  fileSize: number; // bytes
  createdAt: string; // ISO string
  updatedAt?: string;
  tags: string[];
  rating: number; // 0 - 5
  folderId?: string;
  transcript?: string;
  audioUrl: string; // Blob URL or data URL
  waveformData?: number[]; // Array of normalized peaks (0-1) for visualizer
  metadata?: {
    bpm?: number;
    key?: string;
    voiceName?: string;
    emotion?: string;
    prompt?: string;
    isAiGenerated?: boolean;
    source?: 'tts' | 'sfx-generator' | 'beat-sequencer' | 'mic-recording' | 'imported' | 'edited';
    [key: string]: any;
  };
}

export interface AudioFolder {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  color?: string;
  createdAt: string;
}

export interface SoundRecipe {
  title: string;
  description: string;
  category: string;
  duration: number; // seconds
  oscillators: {
    type: 'sine' | 'square' | 'sawtooth' | 'triangle';
    startFreq: number;
    endFreq?: number;
    freqRamp?: 'linear' | 'exponential' | 'none';
    detune?: number;
    gain: number;
  }[];
  envelope: {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
  };
  filter?: {
    type: 'lowpass' | 'highpass' | 'bandpass';
    startCutoff: number;
    endCutoff?: number;
    q: number;
  };
  noise?: {
    type: 'white' | 'pink' | 'brown';
    gain: number;
    duration?: number;
  };
  effects?: {
    distortion?: number;
    reverb?: number; // 0 to 1
    delay?: {
      time: number;
      feedback: number;
    };
    lfo?: {
      target: 'pitch' | 'volume' | 'filter';
      freq: number;
      depth: number;
    };
  };
}

export interface SequencerTrack {
  id: string;
  name: string;
  soundType: 'kick' | 'snare' | 'hihat' | 'bass' | 'lead';
  steps: boolean[]; // 16 steps
  notes?: (string | null)[]; // e.g. "C3", "D#3", null
  volume: number; // 0 to 1
  pan?: number;
}

export interface BeatPattern {
  name: string;
  bpm: number;
  scale: string;
  tracks: SequencerTrack[];
}

export interface AudioEditSettings {
  startTime: number;
  endTime: number;
  fadeIn: number; // seconds
  fadeOut: number; // seconds
  playbackRate: number; // 0.5 - 2.0
  gain: number; // dB (-12 to +12)
  eq: {
    low: number; // dB (-12 to +12)
    mid: number; // dB (-12 to +12)
    high: number; // dB (-12 to +12)
  };
  reverb: number; // 0 to 1
  delay: {
    enabled: boolean;
    time: number; // seconds
    feedback: number; // 0 to 0.8
  };
  normalize: boolean;
}

export interface VoiceModelConfig {
  ttsModel: string; // e.g. 'gemini-3.1-flash-tts-preview'
  transcribeModel: string; // e.g. 'gemini-3.5-transcribe'
  reasoningModel: string; // e.g. 'gemini-3.8-flash'
  defaultVoice: string; // 'Kore' | 'Puck' | 'Fenrir' | 'Charon' | 'Zephyr'
  defaultEmotion: string;
  speed: number; // 0.75 - 1.5
  temperature: number; // 0.1 - 1.2
  sampleRate: number; // 24000
  audioContainer: 'wav' | 'pcm';
  customSystemInstruction: string;
  languageHint: 'zh-CN' | 'en-US' | 'auto' | 'bilingual';
  dialogueSpeaker1: {
    name: string;
    voice: string;
  };
  dialogueSpeaker2: {
    name: string;
    voice: string;
  };
  pacing: 'tight' | 'natural' | 'relaxed';
}

export type TrackType = 'voice' | 'sfx' | 'music' | 'ambient';

export interface TimelineClip {
  id: string;
  itemId?: string;
  name: string;
  audioUrl: string;
  startTime: number; // in seconds on timeline
  duration: number; // in seconds
  offset: number; // in seconds (crop from start)
  volume: number; // 0 to 1.5
  muted: boolean;
  color?: string;
}

export interface MultiTrack {
  id: string;
  name: string;
  type: TrackType;
  volume: number; // 0 to 1.5
  pan: number; // -1 (left) to 1 (right)
  muted: boolean;
  solo: boolean;
  clips: TimelineClip[];
}

export interface MasteringPreset {
  id: string;
  name: string;
  targetLufs: number; // e.g. -14 LUFS, -16 LUFS
  description: string;
  eqBoostLow: number;
  eqBoostHigh: number;
  compressionRatio: number;
}

