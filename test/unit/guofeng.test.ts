import { describe, expect, it } from 'vitest';
import {
  compositionDuration, createGuofengComposition, hasModelMotifs, isGuofengComposition,
  normalizeMotifs, pentatonicPitch, resizeGuofengSection, type GuofengRequest,
} from '../../src/music/guofeng';

const request: GuofengRequest = {
  prompt: '雨后竹林里的清雅配乐', mood: '空灵', scene: '竹林',
  durationSec: 20, bpm: 96, key: 2, scale: 'major-pentatonic',
  instruments: ['guzheng', 'dizi', 'drum'],
};

describe('国风编曲', () => {
  it('把五声音阶级数转成指定主音的正确音高', () => {
    expect([1, 2, 3, 4, 5].map(degree => pentatonicPitch(2, 'major-pentatonic', degree, 4)))
      .toEqual([62, 64, 66, 69, 71]); // D E F# A B
    expect([1, 2, 3, 4, 5].map(degree => pentatonicPitch(0, 'minor-pentatonic', degree, 4)))
      .toEqual([60, 63, 65, 67, 70]); // C Eb F G Bb
  });

  it('生成 15–30 秒的引子、主题和尾声，旋律落在五声音阶内', () => {
    const composition = createGuofengComposition(request);
    expect(composition.sections.map(section => section.name)).toEqual(['引子', '主题', '尾声']);
    expect(compositionDuration(composition)).toBeGreaterThanOrEqual(15);
    expect(compositionDuration(composition)).toBeLessThanOrEqual(30);
    const melody = composition.sections.flatMap(section => section.notes.filter(note => note.trackId === 'dizi'));
    expect(melody.length).toBeGreaterThan(0);
    expect(melody.every(note => [2, 4, 6, 9, 11].includes(note.pitch % 12))).toBe(true);
    for (const section of composition.sections) {
      expect(section.notes.every(note => note.startBeat >= 0 && note.startBeat < section.bars * 4)).toBe(true);
    }
    expect(isGuofengComposition(JSON.parse(JSON.stringify(composition)))).toBe(true);
  });

  it('约束模型给出的越界音符，并在空回应时保留可用旋律', () => {
    const motifs = normalizeMotifs({ phrase: [{ step: 99, degree: 9, lengthSteps: 30, velocity: 5 }], answer: [] });
    expect(motifs.phrase[0]).toEqual({ step: 31, degree: 5, lengthSteps: 8, velocity: 1 });
    expect(motifs.answer.length).toBeGreaterThan(0);
    expect(hasModelMotifs({ phrase: [], answer: [] })).toBe(false);
    expect(hasModelMotifs(motifs)).toBe(true);
  });

  it('所有合法时长与速度组合都能生成可重新载入的工程', () => {
    for (const durationSec of [15, 20, 30]) {
      for (const bpm of [72, 80, 96, 100, 120]) {
        const composition = createGuofengComposition({ ...request, durationSec, bpm });
        expect(compositionDuration(composition)).toBeGreaterThanOrEqual(15);
        expect(compositionDuration(composition)).toBeLessThanOrEqual(30);
        expect(isGuofengComposition(composition)).toBe(true);
      }
    }
  });

  it('给每件选中的乐器安排可听见的音符', () => {
    const composition = createGuofengComposition({ ...request, instruments: ['guzheng', 'pipa', 'dizi', 'erhu', 'drum'] });
    for (const track of composition.tracks) {
      expect(composition.sections.flatMap(section => section.notes).some(note => note.trackId === track.id)).toBe(true);
    }
  });

  it('缩短段落时裁剪越界音符，保存的工程仍可载入', () => {
    const composition = createGuofengComposition(request);
    const resized = resizeGuofengSection(composition, 'theme', composition.sections[1].bars - 1);
    expect(resized.sections[1].notes.every(note => note.startBeat + note.durationBeats <= resized.sections[1].bars * 4)).toBe(true);
    expect(isGuofengComposition(JSON.parse(JSON.stringify(resized)))).toBe(true);
  });
});
