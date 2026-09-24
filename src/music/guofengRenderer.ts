import { audioBufferToWav } from '../utils/audioEngine';
import type { GuofengArticulation, GuofengComposition, GuofengInstrument } from './guofeng';
import { compositionDuration } from './guofeng';

const SAMPLE_RATE = 44100;

function midiFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

/** Locally synthesized instrument voices; no external sample or licensing dependency. */
function synthesizeVoice(
  context: OfflineAudioContext,
  instrument: GuofengInstrument,
  pitch: number,
  duration: number,
  articulation: GuofengArticulation,
): AudioBuffer {
  const release = instrument === 'guzheng' ? 0.65 : instrument === 'pipa' ? 0.35 : 0.18;
  const length = Math.max(0.12, duration + release);
  const count = Math.ceil(length * SAMPLE_RATE);
  const buffer = context.createBuffer(1, count, SAMPLE_RATE);
  const samples = buffer.getChannelData(0);
  const frequency = midiFrequency(pitch);
  let seed = (pitch * 2654435761 + count) >>> 0;
  const noise = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 2147483648 - 1;
  };

  if (instrument === 'guzheng' || instrument === 'pipa') {
    // Damped string delay line gives the two plucked voices a natural decay.
    const delayLength = Math.max(2, Math.round(SAMPLE_RATE / frequency));
    const string = new Float32Array(delayLength);
    for (let i = 0; i < delayLength; i++) string[i] = noise() * (instrument === 'pipa' ? 0.85 : 0.72);
    const damping = instrument === 'pipa' ? 0.986 : 0.995;
    for (let i = 0; i < count; i++) {
      const index = i % delayLength;
      const next = (index + 1) % delayLength;
      const value = string[index];
      string[index] = (value + string[next]) * 0.5 * damping;
      const t = i / SAMPLE_RATE;
      const gate = t <= duration ? 1 : Math.exp(-(t - duration) * (instrument === 'pipa' ? 11 : 5));
      const tremolo = articulation === 'tremolo' ? 0.7 + 0.3 * Math.sin(2 * Math.PI * 9 * t) ** 2 : 1;
      samples[i] = value * gate * tremolo;
    }
    return buffer;
  }

  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const attack = instrument === 'erhu' ? 0.09 : 0.035;
    const envelope = Math.min(1, t / attack) * (t < duration ? 1 : Math.exp(-(t - duration) * 14));
    const vibrato = instrument === 'drum' ? 0 : 0.0035 * Math.sin(2 * Math.PI * 5.2 * t);
    const slide = articulation === 'slide' ? -0.04 * Math.exp(-t * 9) : 0;
    const phase = 2 * Math.PI * frequency * (t + vibrato * t + slide * t);
    let wave: number;
    if (instrument === 'dizi') {
      wave = Math.sin(phase) * 0.78 + Math.sin(phase * 2) * 0.18 + Math.sin(phase * 3) * 0.055 + noise() * 0.035;
    } else if (instrument === 'erhu') {
      wave = Math.sin(phase) * 0.55 + Math.sin(phase * 2) * 0.26 + Math.sin(phase * 3) * 0.13 + Math.sin(phase * 4) * 0.06 + noise() * 0.018;
    } else {
      const falling = 90 * Math.exp(-t * 27) + 42;
      wave = Math.sin(2 * Math.PI * falling * t) * Math.exp(-t * 12) + noise() * 0.2 * Math.exp(-t * 24);
    }
    const tremolo = articulation === 'tremolo' ? 0.76 + 0.24 * Math.sin(2 * Math.PI * 7 * t) ** 2 : 1;
    samples[i] = wave * envelope * tremolo * (instrument === 'drum' ? 0.6 : 0.75);
  }
  return buffer;
}

export async function renderGuofengComposition(composition: GuofengComposition): Promise<{ blob: Blob; audioUrl: string; duration: number }> {
  const duration = compositionDuration(composition);
  if (!Number.isFinite(duration) || duration < 1 || duration > 90) throw new Error('编曲时长必须在 1–90 秒之间。');
  const context = new OfflineAudioContext(2, Math.ceil(Math.min(30, duration + 0.8) * SAMPLE_RATE), SAMPLE_RATE);
  const master = context.createGain();
  master.gain.value = 0.65;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -15;
  compressor.ratio.value = 3;
  master.connect(compressor);
  compressor.connect(context.destination);

  let sectionStartBeat = 0;
  for (const section of composition.sections) {
    const sectionBeats = section.bars * 4;
    for (const note of section.notes) {
      const track = composition.tracks.find((candidate) => candidate.id === note.trackId);
      if (!track || track.muted || !Number.isFinite(note.startBeat) || !Number.isFinite(note.durationBeats)) continue;
      if (note.startBeat < 0 || note.startBeat >= sectionBeats || note.durationBeats <= 0) continue;
      const noteDuration = Math.min(note.durationBeats, sectionBeats - note.startBeat) * 60 / composition.bpm;
      const startTime = (sectionStartBeat + note.startBeat) * 60 / composition.bpm;
      const source = context.createBufferSource();
      source.buffer = synthesizeVoice(context, track.instrument, Math.max(36, Math.min(96, note.pitch)), noteDuration, note.articulation);
      if (note.articulation === 'slide' && (track.instrument === 'guzheng' || track.instrument === 'pipa')) {
        source.playbackRate.setValueAtTime(2 ** (-2 / 12), startTime);
        source.playbackRate.exponentialRampToValueAtTime(1, startTime + Math.min(0.18, noteDuration * 0.6));
      }
      const gain = context.createGain();
      gain.gain.value = Math.max(0, Math.min(1, track.volume)) * Math.max(0, Math.min(1, note.velocity));
      const pan = context.createStereoPanner();
      pan.pan.value = track.instrument === 'guzheng' ? -0.32 : track.instrument === 'pipa' ? 0.3 : track.instrument === 'erhu' ? 0.12 : 0;
      source.connect(gain);
      gain.connect(pan);
      pan.connect(master);
      source.start(startTime);
    }
    sectionStartBeat += sectionBeats;
  }

  const rendered = await context.startRendering();
  const blob = audioBufferToWav(rendered);
  return { blob, audioUrl: URL.createObjectURL(blob), duration: rendered.duration };
}
