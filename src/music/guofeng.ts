export const GUOFENG_INSTRUMENTS = ['guzheng', 'pipa', 'dizi', 'erhu', 'drum'] as const;
export type GuofengInstrument = typeof GUOFENG_INSTRUMENTS[number];
export type GuofengScale = 'major-pentatonic' | 'minor-pentatonic';
export type GuofengArticulation = 'normal' | 'slide' | 'tremolo';

export const INSTRUMENT_LABELS: Record<GuofengInstrument, string> = {
  guzheng: '古筝', pipa: '琵琶', dizi: '笛子', erhu: '二胡', drum: '鼓',
};

export interface GuofengNote {
  id: string;
  trackId: string;
  pitch: number; // MIDI 36–96
  startBeat: number; // relative to section, quarter-note beat
  durationBeats: number;
  velocity: number; // 0–1
  articulation: GuofengArticulation;
}

export interface GuofengTrack {
  id: string;
  instrument: GuofengInstrument;
  volume: number;
  muted: boolean;
}

export interface GuofengSection {
  id: string;
  name: string;
  bars: number;
  notes: GuofengNote[];
}

export interface GuofengComposition {
  version: 1;
  title: string;
  prompt: string;
  mood: string;
  scene: string;
  bpm: number;
  key: number; // C=0 ... B=11
  scale: GuofengScale;
  tracks: GuofengTrack[];
  sections: GuofengSection[];
  generator: 'rules' | 'ollama' | 'gemini' | 'manual';
}

export interface GuofengRequest {
  prompt: string;
  mood: string;
  scene: string;
  durationSec: number;
  bpm: number;
  key: number;
  scale: GuofengScale;
  instruments: GuofengInstrument[];
}

export interface MotifEvent {
  step: number; // 0–31, 16th-note positions within 2 bars
  degree: number; // pentatonic degree 1–5
  lengthSteps: number;
  velocity: number;
}

export interface GuofengMotifs {
  phrase: MotifEvent[];
  answer: MotifEvent[];
}

export function hasModelMotifs(value: unknown): value is GuofengMotifs {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return ['phrase', 'answer'].every(part => Array.isArray(candidate[part]) &&
    (candidate[part] as unknown[]).some(event => {
      if (!event || typeof event !== 'object') return false;
      const note = event as Record<string, unknown>;
      return ['step', 'degree', 'lengthSteps', 'velocity'].every(key => typeof note[key] === 'number' && Number.isFinite(note[key]));
    }));
}

const DEFAULT_MOTIFS: GuofengMotifs = {
  phrase: [
    { step: 0, degree: 1, lengthSteps: 4, velocity: 0.76 },
    { step: 5, degree: 2, lengthSteps: 3, velocity: 0.68 },
    { step: 9, degree: 3, lengthSteps: 6, velocity: 0.82 },
    { step: 17, degree: 5, lengthSteps: 4, velocity: 0.72 },
    { step: 23, degree: 3, lengthSteps: 7, velocity: 0.78 },
  ],
  answer: [
    { step: 0, degree: 5, lengthSteps: 4, velocity: 0.74 },
    { step: 6, degree: 3, lengthSteps: 4, velocity: 0.7 },
    { step: 12, degree: 2, lengthSteps: 3, velocity: 0.65 },
    { step: 18, degree: 3, lengthSteps: 4, velocity: 0.72 },
    { step: 24, degree: 1, lengthSteps: 8, velocity: 0.82 },
  ],
};

export function normalizeMotifs(value: unknown): GuofengMotifs {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const normalize = (raw: unknown, fallback: MotifEvent[]) => {
    if (!Array.isArray(raw)) return fallback;
    const events = raw.slice(0, 24).map((event): MotifEvent | null => {
      if (!event || typeof event !== 'object') return null;
      const note = event as Record<string, unknown>;
      const step = Number(note.step);
      const degree = Number(note.degree);
      const lengthSteps = Number(note.lengthSteps);
      const velocity = Number(note.velocity);
      if (![step, degree, lengthSteps, velocity].every(Number.isFinite)) return null;
      return {
        step: Math.max(0, Math.min(31, Math.round(step))),
        degree: Math.max(1, Math.min(5, Math.round(degree))),
        lengthSteps: Math.max(1, Math.min(8, Math.round(lengthSteps))),
        velocity: Math.max(0.2, Math.min(1, velocity)),
      };
    }).filter((event): event is MotifEvent => event !== null).sort((a, b) => a.step - b.step);
    return events.length ? events : fallback;
  };
  return {
    phrase: normalize(source.phrase, DEFAULT_MOTIFS.phrase),
    answer: normalize(source.answer, DEFAULT_MOTIFS.answer),
  };
}

const PENTATONIC: Record<GuofengScale, number[]> = {
  'major-pentatonic': [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
};

export function pentatonicPitch(key: number, scale: GuofengScale, degree: number, octave: number): number {
  const intervals = PENTATONIC[scale];
  const zeroBased = Math.max(0, Math.round(degree) - 1);
  return 12 * (octave + 1) + key + intervals[zeroBased % 5] + 12 * Math.floor(zeroBased / 5);
}

export function compositionDuration(composition: GuofengComposition): number {
  return composition.sections.reduce((beats, section) => beats + section.bars * 4, 0) * 60 / composition.bpm;
}

export function resizeGuofengSection(composition: GuofengComposition, sectionId: string, bars: number): GuofengComposition {
  if (!Number.isInteger(bars) || bars < 1 || bars > 16) throw new Error('段落须为 1–16 小节。');
  const sections = composition.sections.map(section => section.id !== sectionId ? section : {
    ...section, bars,
    notes: section.notes.filter(note => note.startBeat < bars * 4).map(note => ({
      ...note, durationBeats: Math.min(note.durationBeats, bars * 4 - note.startBeat),
    })),
  });
  const resized = { ...composition, sections };
  const duration = compositionDuration(resized);
  if (duration < 15 || duration > 30) throw new Error('整首作品须保持在 15–30 秒之间。');
  return resized;
}

export function createGuofengComposition(request: GuofengRequest, rawMotifs?: unknown, generator: GuofengComposition['generator'] = 'rules'): GuofengComposition {
  const bpm = Math.max(72, Math.min(120, Math.round(request.bpm || 96)));
  const durationSec = Math.max(15, Math.min(30, Number(request.durationSec) || 20));
  const minimumBars = Math.ceil(15 * bpm / 240);
  const maximumBars = Math.floor(30 * bpm / 240);
  const totalBars = Math.max(minimumBars, Math.min(maximumBars, Math.round(durationSec * bpm / 240)));
  const key = Math.max(0, Math.min(11, Math.round(request.key || 0)));
  const scale: GuofengScale = request.scale === 'minor-pentatonic' ? 'minor-pentatonic' : 'major-pentatonic';
  const instruments = [...new Set(request.instruments.filter((instrument) => GUOFENG_INSTRUMENTS.includes(instrument)))];
  if (!instruments.length) instruments.push('guzheng', 'dizi', 'drum');
  const tracks = instruments.map((instrument) => ({ id: instrument, instrument, volume: instrument === 'drum' ? 0.35 : 0.8, muted: false }));
  const melodicTracks = tracks.filter(track => track.instrument === 'dizi' || track.instrument === 'erhu');
  const pluckedTracks = tracks.filter(track => track.instrument === 'guzheng' || track.instrument === 'pipa');
  const leadTracks = melodicTracks.length ? melodicTracks : pluckedTracks.slice(0, 1);
  const motifs = normalizeMotifs(rawMotifs);
  const isBold = request.mood === '昂扬';
  const isSomber = request.mood === '悲怆';
  const sections: GuofengSection[] = [
    { id: 'intro', name: '引子', bars: 1, notes: [] },
    { id: 'theme', name: '主题', bars: totalBars - 2, notes: [] },
    { id: 'outro', name: '尾声', bars: 1, notes: [] },
  ];
  let noteIndex = 0;
  const add = (section: GuofengSection, trackId: string, pitch: number, startBeat: number, durationBeats: number, velocity: number, articulation: GuofengArticulation) => {
    section.notes.push({ id: `n${++noteIndex}`, trackId, pitch, startBeat, durationBeats, velocity, articulation });
  };
  const root = pentatonicPitch(key, scale, 1, 3);
  for (const section of sections) {
    for (let bar = 0; bar < section.bars; bar++) {
      const barBeat = bar * 4;
      for (const plucked of pluckedTracks) {
        const emphasis = plucked.instrument === 'pipa' ? 0.78 : 1;
        add(section, plucked.id, root + (bar % 2 ? 7 : 0), barBeat, 1.75, (section.id === 'theme' ? 0.62 : 0.45) * emphasis, 'normal');
        if (section.id === 'theme') add(section, plucked.id, root + 12, barBeat + 2, 1.3, 0.44 * emphasis, 'tremolo');
        if (isBold && section.id === 'theme') add(section, plucked.id, root + 7, barBeat + 3, 0.75, 0.56 * emphasis, 'normal');
      }
      if (tracks.some((track) => track.instrument === 'drum') && section.id === 'theme') {
        add(section, 'drum', 36, barBeat, 0.4, isBold ? 0.65 : 0.4, 'normal');
        if (isBold || isSomber) add(section, 'drum', 36, barBeat + 2, 0.4, isBold ? 0.52 : 0.22, 'normal');
      }
      const motif = bar % 4 < 2 ? motifs.phrase : motifs.answer;
      for (const event of motif) {
        if (Math.floor(event.step / 16) !== bar % 2) continue;
        if (section.id === 'intro' && event.step % 16 < 8) continue;
        if (section.id === 'outro' && event.step % 16 > 8) continue;
        for (const [index, lead] of leadTracks.entries()) {
          const pitch = pentatonicPitch(key, scale, event.degree, lead.instrument === 'erhu' || isSomber ? 4 : 5);
          add(section, lead.id, pitch, barBeat + (event.step % 16) / 4, Math.min(event.lengthSteps / 4 * (isSomber ? 1.2 : 1), 4 - (event.step % 16) / 4), event.velocity * (section.id === 'theme' ? 1 : 0.7) * (index ? 0.72 : 1), event.lengthSteps >= 6 ? 'slide' : 'normal');
        }
      }
    }
  }
  return {
    version: 1,
    title: request.prompt.trim().slice(0, 48) || `${request.scene || '山水'}国风配乐`,
    prompt: request.prompt.trim(), mood: request.mood, scene: request.scene,
    bpm, key, scale, tracks, sections, generator,
  };
}

export function isGuofengComposition(value: unknown): value is GuofengComposition {
  if (!value || typeof value !== 'object') return false;
  const composition = value as Partial<GuofengComposition>;
  if (composition.version !== 1 || typeof composition.title !== 'string' ||
      !Number.isFinite(composition.bpm) || (composition.bpm ?? 0) < 60 || (composition.bpm ?? 0) > 180 ||
      !Number.isInteger(composition.key) || (composition.key ?? -1) < 0 || (composition.key ?? 12) > 11 ||
      !['major-pentatonic', 'minor-pentatonic'].includes(composition.scale || '') ||
      !Array.isArray(composition.tracks) || composition.tracks.length === 0 ||
      !Array.isArray(composition.sections) || composition.sections.length === 0) return false;
  const tracksAreValid = composition.tracks.every(track =>
    typeof track.id === 'string' && GUOFENG_INSTRUMENTS.includes(track.instrument) &&
    Number.isFinite(track.volume) && track.volume >= 0 && track.volume <= 1 && typeof track.muted === 'boolean');
  const trackIds = new Set(composition.tracks.map(track => track.id));
  const sectionsAreValid = composition.sections.every(section =>
    typeof section.id === 'string' && typeof section.name === 'string' &&
    Number.isInteger(section.bars) && section.bars >= 1 && section.bars <= 16 &&
    Array.isArray(section.notes) && section.notes.every(note =>
      typeof note.id === 'string' && trackIds.has(note.trackId) &&
      Number.isInteger(note.pitch) && note.pitch >= 36 && note.pitch <= 96 &&
      Number.isFinite(note.startBeat) && note.startBeat >= 0 && note.startBeat < section.bars * 4 &&
      Number.isFinite(note.durationBeats) && note.durationBeats > 0 &&
      Number.isFinite(note.velocity) && note.velocity >= 0 && note.velocity <= 1 &&
      ['normal', 'slide', 'tremolo'].includes(note.articulation)));
  return tracksAreValid && sectionsAreValid && compositionDuration(composition as GuofengComposition) >= 15 && compositionDuration(composition as GuofengComposition) <= 30;
}
