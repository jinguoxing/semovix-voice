/**
 * AudioCraft Studio - Comprehensive Web Audio DSP Engine
 */

import { SoundRecipe, BeatPattern, AudioEditSettings } from '../types/audio';

// Shared AudioContext for live playback
let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

/**
 * Converts an AudioBuffer into a WAV Blob
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Interleave channel samples & write 16-bit PCM
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = channels[channel][i];
      // Clamp between -1 and 1
      sample = Math.max(-1, Math.min(1, sample));
      // Scale to 16-bit signed integer
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Extracts normalized peak heights (0 to 1) for waveform visualizations
 */
export function extractPeaks(buffer: AudioBuffer, numPeaks = 64): number[] {
  const channelData = buffer.getChannelData(0);
  const step = Math.floor(channelData.length / numPeaks);
  const peaks: number[] = [];

  for (let i = 0; i < numPeaks; i++) {
    const start = i * step;
    const end = Math.min(start + step, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) max = val;
    }
    // Normalize and add minimal threshold so empty spots look nice
    peaks.push(Math.max(0.08, Math.min(1.0, max)));
  }

  return peaks;
}

/**
 * Simple Synthetic Impulse Response for Reverb
 */
function createReverbImpulse(ctx: BaseAudioContext, duration = 1.5, decay = 2.0): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i / length;
    const mult = Math.exp(-n * decay);
    left[i] = (Math.random() * 2 - 1) * mult;
    right[i] = (Math.random() * 2 - 1) * mult;
  }
  return impulse;
}

/**
 * Note name to Frequency converter (e.g. C3 -> 130.81, A4 -> 440)
 */
export function noteToFreq(note: string): number {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const regex = /^([A-G][#b]?)([0-8])$/;
  const match = note.match(regex);
  if (!match) return 440;

  let noteName = match[1];
  const octave = parseInt(match[2], 10);

  // Normalize flats
  const flatMap: Record<string, string> = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
  if (flatMap[noteName]) noteName = flatMap[noteName];

  const noteIndex = notes.indexOf(noteName);
  if (noteIndex === -1) return 440;

  // A4 = index 9 in octave 4 = 440 Hz
  const semitonesFromA4 = (octave - 4) * 12 + (noteIndex - 9);
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

// -------------------------------------------------------------
// 1. Procedural SFX Synthesizer
// -------------------------------------------------------------

export async function renderSoundRecipe(recipe: SoundRecipe): Promise<{ audioUrl: string; duration: number; buffer: AudioBuffer }> {
  const duration = Math.min(6.0, Math.max(0.2, recipe.duration || 1.5));
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);

  const masterGain = offlineCtx.createGain();
  masterGain.gain.setValueAtTime(0.85, 0);

  // Reverb setup if configured
  if (recipe.effects?.reverb && recipe.effects.reverb > 0) {
    const convolver = offlineCtx.createConvolver();
    convolver.buffer = createReverbImpulse(offlineCtx, 1.2, 2.5);
    const dryGain = offlineCtx.createGain();
    const wetGain = offlineCtx.createGain();

    const wetAmount = Math.min(0.8, recipe.effects.reverb);
    dryGain.gain.setValueAtTime(1 - wetAmount * 0.5, 0);
    wetGain.gain.setValueAtTime(wetAmount, 0);

    masterGain.connect(dryGain);
    dryGain.connect(offlineCtx.destination);

    masterGain.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(offlineCtx.destination);
  } else {
    masterGain.connect(offlineCtx.destination);
  }

  // Filter setup
  let filterNode: BiquadFilterNode | null = null;
  if (recipe.filter) {
    filterNode = offlineCtx.createBiquadFilter();
    filterNode.type = recipe.filter.type || 'lowpass';
    filterNode.Q.setValueAtTime(recipe.filter.q || 2, 0);
    filterNode.frequency.setValueAtTime(recipe.filter.startCutoff || 2000, 0);
    if (recipe.filter.endCutoff) {
      filterNode.frequency.exponentialRampToValueAtTime(
        Math.max(20, recipe.filter.endCutoff),
        duration
      );
    }
    filterNode.connect(masterGain);
  }

  const destinationNode = filterNode || masterGain;

  // Synthesize Oscillators
  if (recipe.oscillators && recipe.oscillators.length > 0) {
    recipe.oscillators.forEach(oscConfig => {
      const osc = offlineCtx.createOscillator();
      const oscGain = offlineCtx.createGain();

      osc.type = oscConfig.type || 'sine';
      if (oscConfig.detune) osc.detune.setValueAtTime(oscConfig.detune, 0);

      const startFreq = Math.max(20, oscConfig.startFreq || 440);
      osc.frequency.setValueAtTime(startFreq, 0);

      if (oscConfig.endFreq) {
        const endFreq = Math.max(20, oscConfig.endFreq);
        if (oscConfig.freqRamp === 'linear') {
          osc.frequency.linearRampToValueAtTime(endFreq, duration);
        } else {
          osc.frequency.exponentialRampToValueAtTime(endFreq, duration);
        }
      }

      // ADSR Envelope
      const env = recipe.envelope;
      const attack = Math.max(0.001, env.attack || 0.01);
      const decay = Math.max(0.01, env.decay || 0.2);
      const sustain = Math.max(0.0, Math.min(1.0, env.sustain || 0.5));
      const release = Math.max(0.01, env.release || 0.3);

      const peakGain = (oscConfig.gain || 0.5) * 0.8;
      oscGain.gain.setValueAtTime(0.0001, 0);
      oscGain.gain.exponentialRampToValueAtTime(peakGain, attack);
      oscGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain * sustain), attack + decay);

      const releaseStart = Math.max(attack + decay, duration - release);
      oscGain.gain.setValueAtTime(Math.max(0.0001, peakGain * sustain), releaseStart);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, duration);

      osc.connect(oscGain);
      oscGain.connect(destinationNode);

      osc.start(0);
      osc.stop(duration);
    });
  }

  // Synthesize Noise Generator (White/Pink/Brown)
  if (recipe.noise && recipe.noise.gain > 0) {
    const noiseLength = Math.ceil(sampleRate * (recipe.noise.duration || duration));
    const noiseBuffer = offlineCtx.createBuffer(1, noiseLength, sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);

    let lastOut = 0.0;
    for (let i = 0; i < noiseLength; i++) {
      const white = Math.random() * 2 - 1;
      if (recipe.noise.type === 'pink') {
        // Simple 1-pole pink noise filter approximation
        lastOut = lastOut * 0.9 + white * 0.1;
        noiseData[i] = lastOut * 3;
      } else if (recipe.noise.type === 'brown') {
        lastOut = (lastOut + 0.02 * white) / 1.02;
        noiseData[i] = lastOut * 3.5;
      } else {
        noiseData[i] = white;
      }
    }

    const noiseSource = offlineCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const noiseGain = offlineCtx.createGain();
    const nGain = recipe.noise.gain * 0.4;
    noiseGain.gain.setValueAtTime(nGain, 0);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, duration);

    noiseSource.connect(noiseGain);
    noiseGain.connect(destinationNode);

    noiseSource.start(0);
    noiseSource.stop(duration);
  }

  const renderedBuffer = await offlineCtx.startRendering();
  const wavBlob = audioBufferToWav(renderedBuffer);
  const audioUrl = URL.createObjectURL(wavBlob);

  return { audioUrl, duration, buffer: renderedBuffer };
}

// -------------------------------------------------------------
// 2. 16-Step Beat & Melody Sequencer Engine
// -------------------------------------------------------------

function scheduleDrumSound(ctx: BaseAudioContext, type: string, time: number, volume: number, note?: string | null) {
  const master = ctx.createGain();
  master.gain.setValueAtTime(volume, time);
  master.connect(ctx.destination);

  if (type === 'kick') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);

    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    osc.connect(gain);
    gain.connect(master);
    osc.start(time);
    osc.stop(time + 0.35);

    // Punch click
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.frequency.setValueAtTime(800, time);
    clickGain.gain.setValueAtTime(0.4, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
    clickOsc.connect(clickGain);
    clickGain.connect(master);
    clickOsc.start(time);
    clickOsc.stop(time + 0.02);

  } else if (type === 'snare') {
    // Noise body
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1000, time);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.9, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(time);
    noise.stop(time + 0.2);

    // Tone body
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.frequency.setValueAtTime(190, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.1);
    oscGain.gain.setValueAtTime(0.6, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(oscGain);
    oscGain.connect(master);
    osc.start(time);
    osc.stop(time + 0.12);

  } else if (type === 'hihat') {
    const bufferSize = ctx.sampleRate * 0.08;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(8000, time);
    filter.Q.setValueAtTime(3, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    noise.start(time);
    noise.stop(time + 0.08);

  } else if (type === 'bass') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    const freq = note ? noteToFreq(note) : 65.41; // C2 default
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, time);

    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(time);
    osc.stop(time + 0.25);

  } else if (type === 'lead') {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    const freq = note ? noteToFreq(note) : 261.63; // C4 default

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, time);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(freq * 1.004, time); // detune

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, time);
    filter.frequency.exponentialRampToValueAtTime(400, time + 0.2);

    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.3);
    osc2.stop(time + 0.3);
  }
}

/**
 * Renders a full beat pattern (loops 2 bars = 32 steps or 1 bar = 16 steps) into a WAV Blob
 */
export async function renderBeatPattern(pattern: BeatPattern, loops = 2): Promise<{ audioUrl: string; duration: number; buffer: AudioBuffer }> {
  const bpm = Math.max(60, Math.min(180, pattern.bpm || 100));
  const secondsPerBeat = 60 / bpm;
  const stepDuration = secondsPerBeat / 4; // 16th notes
  const singleLoopDuration = 16 * stepDuration;
  const totalDuration = singleLoopDuration * loops + 0.5; // tail

  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDuration), sampleRate);

  for (let l = 0; l < loops; l++) {
    const loopOffset = l * singleLoopDuration;
    for (let step = 0; step < 16; step++) {
      const stepTime = loopOffset + step * stepDuration;
      pattern.tracks.forEach(track => {
        if (track.steps[step]) {
          const note = track.notes?.[step] || null;
          scheduleDrumSound(offlineCtx, track.soundType, stepTime, track.volume ?? 0.8, note);
        }
      });
    }
  }

  const rendered = await offlineCtx.startRendering();
  const blob = audioBufferToWav(rendered);
  const audioUrl = URL.createObjectURL(blob);

  return { audioUrl, duration: totalDuration, buffer: rendered };
}

// -------------------------------------------------------------
// 3. Audio Editor & DSP Processor Rack
// -------------------------------------------------------------

export async function processAudio(
  sourceBuffer: AudioBuffer,
  settings: AudioEditSettings
): Promise<{ audioUrl: string; duration: number; buffer: AudioBuffer }> {
  const start = Math.max(0, settings.startTime);
  const end = Math.min(sourceBuffer.duration, settings.endTime > 0 ? settings.endTime : sourceBuffer.duration);
  const clipDuration = Math.max(0.1, (end - start) / (settings.playbackRate || 1.0));

  const sampleRate = sourceBuffer.sampleRate;
  const offlineCtx = new OfflineAudioContext(sourceBuffer.numberOfChannels, Math.ceil(sampleRate * (clipDuration + 0.3)), sampleRate);

  // 1. Source Node
  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = settings.playbackRate || 1.0;

  // 2. Gain & Fade Envelopes
  const gainNode = offlineCtx.createGain();
  const linearGain = Math.pow(10, (settings.gain || 0) / 20); // dB to amplitude
  gainNode.gain.setValueAtTime(linearGain, 0);

  // Fade In
  if (settings.fadeIn > 0) {
    gainNode.gain.setValueAtTime(0.0001, 0);
    gainNode.gain.exponentialRampToValueAtTime(linearGain, Math.min(clipDuration, settings.fadeIn));
  }

  // Fade Out
  if (settings.fadeOut > 0) {
    const fadeOutStart = Math.max(0, clipDuration - settings.fadeOut);
    gainNode.gain.setValueAtTime(linearGain, fadeOutStart);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, clipDuration);
  }

  // 3. 3-Band Equalizer
  const lowEQ = offlineCtx.createBiquadFilter();
  lowEQ.type = 'lowshelf';
  lowEQ.frequency.value = 250;
  lowEQ.gain.value = settings.eq.low;

  const midEQ = offlineCtx.createBiquadFilter();
  midEQ.type = 'peaking';
  midEQ.frequency.value = 1000;
  midEQ.gain.value = settings.eq.mid;

  const highEQ = offlineCtx.createBiquadFilter();
  highEQ.type = 'highshelf';
  highEQ.frequency.value = 4000;
  highEQ.gain.value = settings.eq.high;

  // 4. Delay & Reverb
  let lastNode: AudioNode = source;
  lastNode.connect(lowEQ);
  lowEQ.connect(midEQ);
  midEQ.connect(highEQ);
  highEQ.connect(gainNode);

  if (settings.reverb > 0) {
    const convolver = offlineCtx.createConvolver();
    convolver.buffer = createReverbImpulse(offlineCtx, 1.5, 2.0);
    const dry = offlineCtx.createGain();
    const wet = offlineCtx.createGain();

    dry.gain.value = 1 - settings.reverb * 0.5;
    wet.gain.value = settings.reverb;

    gainNode.connect(dry);
    dry.connect(offlineCtx.destination);

    gainNode.connect(convolver);
    convolver.connect(wet);
    wet.connect(offlineCtx.destination);
  } else {
    gainNode.connect(offlineCtx.destination);
  }

  source.start(0, start, end - start);

  let rendered = await offlineCtx.startRendering();

  // Normalize if requested
  if (settings.normalize) {
    let maxPeak = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > maxPeak) maxPeak = abs;
      }
    }
    if (maxPeak > 0.001) {
      const normFactor = 0.95 / maxPeak;
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const data = rendered.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          data[i] *= normFactor;
        }
      }
    }
  }

  const blob = audioBufferToWav(rendered);
  const audioUrl = URL.createObjectURL(blob);

  return { audioUrl, duration: clipDuration, buffer: rendered };
}
