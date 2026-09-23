/**
 * 可靠 WAV 解析器单元测试。
 * 覆盖：标准头、附加块（LIST/JUNK 奇数补位）、WAVE_FORMAT_EXTENSIBLE、
 * 流式 data 长度占位（0xFFFFFFFF/越界）、非 PCM 编码拒绝、拼接格式校验、24-bit 封包。
 */
import { describe, it, expect } from 'vitest';
import {
  parseWav, extractPcm16, encodeWav, wavDuration, concatWavBuffers, WavParseError,
} from '../../server/audio/wav';
import { applySpeedToWav } from '../../server/audio/wsola';

function makePcm16(samples: number[], channels = 1): Buffer {
  const buf = Buffer.alloc(samples.length * 2 * channels);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}

/** 构造带任意前置块的标准 PCM WAV */
function buildWav(opts: {
  pcm: Buffer;
  sampleRate?: number;
  channels?: number;
  bits?: number;
  preChunks?: Array<{ id: string; payload: Buffer }>;
  declareDataSize?: number;
  formatTag?: number;
  fmtExtra?: Buffer;
}): Buffer {
  const {
    pcm, sampleRate = 24000, channels = 1, bits = 16,
    preChunks = [], declareDataSize, formatTag = 1, fmtExtra = Buffer.alloc(0),
  } = opts;
  const blockAlign = (channels * bits) / 8;
  const fmt = Buffer.alloc(16 + fmtExtra.length);
  fmt.writeUInt16LE(formatTag, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * blockAlign, 8);
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(bits, 14);
  fmtExtra.copy(fmt, 16);

  const parts: Buffer[] = [Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')];
  const push = (id: string, payload: Buffer) => {
    parts.push(Buffer.from(id, 'ascii'));
    const size = Buffer.alloc(4);
    size.writeUInt32LE(payload.length);
    parts.push(size, payload);
    if (payload.length % 2 === 1) parts.push(Buffer.alloc(1)); // RIFF 奇数补位
  };
  push('fmt ', fmt);
  for (const c of preChunks) push(c.id, c.payload);
  parts.push(Buffer.from('data'));
  const dataSize = Buffer.alloc(4);
  dataSize.writeUInt32LE(declareDataSize ?? pcm.length);
  parts.push(dataSize, pcm);

  const file = Buffer.concat(parts);
  file.writeUInt32LE(file.length - 8, 4);
  return file;
}

describe('parseWav', () => {
  it('parses a canonical 44-byte PCM WAV', () => {
    const pcm = makePcm16([0, 1000, -1000, 500]);
    const wav = buildWav({ pcm });
    const info = parseWav(wav);
    expect(info.format.audioFormat).toBe(1);
    expect(info.format.codec).toBe('pcm');
    expect(info.format.channels).toBe(1);
    expect(info.format.sampleRate).toBe(24000);
    expect(info.format.bitsPerSample).toBe(16);
    expect(info.dataLength).toBe(pcm.length);
    expect(info.dataOffset).toBe(44);
    expect(info.durationSec).toBeCloseTo(pcm.length / (24000 * 2), 6);
  });

  it('skips LIST/JUNK chunks (with odd-size padding) before data', () => {
    const pcm = makePcm16(new Array(4800).fill(300)); // 0.2s @24kHz
    const wav = buildWav({
      pcm,
      preChunks: [
        { id: 'LIST', payload: Buffer.from('INFOISFT', 'ascii') }, // 8 字节偶数
        { id: 'JUNK', payload: Buffer.alloc(7) },                  // 7 字节奇数 → 1 pad
      ],
    });
    const info = parseWav(wav);
    expect(info.dataLength).toBe(pcm.length);
    expect(info.dataOffset).toBe(44 + (8 + 8) + (8 + 7 + 1));
    expect(wavDuration(wav)).toBe(0.2);
  });

  it('resolves WAVE_FORMAT_EXTENSIBLE sub-format', () => {
    const pcm = makePcm16([1, 2, 3, 4], 2); // 立体声
    // extensible fmt: cbSize=22, validBits=16, channelMask=3, SubFormat GUID(16) 前 2 字节 = PCM
    const extra = Buffer.alloc(24); // cbSize(2)+validBits(2)+mask(4)+GUID(16) = 24，fmt 总长 40
    extra.writeUInt16LE(22, 0);
    extra.writeUInt16LE(16, 2);
    extra.writeUInt32LE(0x3, 4);
    extra.writeUInt16LE(0x0001, 8); // fmt 偏移 24 = base16 + extra 偏移 8
    const wav = buildWav({ pcm, channels: 2, formatTag: 0xFFFE, fmtExtra: extra });
    const info = parseWav(wav);
    expect(info.format.rawFormatTag).toBe(0xFFFE);
    expect(info.format.audioFormat).toBe(1);
    expect(info.format.codec).toBe('pcm');
    expect(info.format.channels).toBe(2);
  });

  it('clamps placeholder data size 0xFFFFFFFF to actual bytes', () => {
    const pcm = makePcm16(new Array(2400).fill(100)); // 0.1s
    const wav = buildWav({ pcm, declareDataSize: 0xFFFFFFFF });
    const info = parseWav(wav);
    expect(info.declaredDataLength).toBe(0xFFFFFFFF);
    expect(info.dataLength).toBe(pcm.length);
    expect(wavDuration(wav)).toBe(0.1);
  });

  it('identifies float-encoded WAV and refuses extractPcm16', () => {
    const pcm = Buffer.alloc(4800); // 内容无所谓，parse 不读采样
    const wav = buildWav({ pcm, formatTag: 3 });
    const info = parseWav(wav);
    expect(info.format.codec).toBe('float');
    expect(() => extractPcm16(wav)).toThrow(WavParseError);
  });

  it('rejects garbage and missing chunks', () => {
    expect(() => parseWav(Buffer.alloc(10))).toThrow(WavParseError);
    expect(() => parseWav(Buffer.from('MP3DATA-NOT-WAV-XX'))).toThrow(WavParseError);
    const noData = Buffer.concat([
      Buffer.from('RIFF'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(4, 0); return b; })(),
      Buffer.from('WAVE'), Buffer.from('fmt '), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(16, 0); return b; })(),
      (() => { const f = Buffer.alloc(16); f.writeUInt16LE(1, 0); f.writeUInt16LE(1, 2); f.writeUInt32LE(24000, 4); f.writeUInt32LE(48000, 8); f.writeUInt16LE(2, 12); f.writeUInt16LE(16, 14); return f; })(),
    ]);
    expect(() => parseWav(noData)).toThrow(/data/);
  });
});

describe('encodeWav / roundtrip', () => {
  it('roundtrips 16-bit PCM', () => {
    const pcm = makePcm16([0, 1234, -5678]);
    const wav = encodeWav(pcm, { sampleRate: 48000, channels: 2, bitsPerSample: 16 });
    const info = parseWav(wav);
    expect(info.format.sampleRate).toBe(48000);
    expect(info.format.channels).toBe(2);
    expect(info.dataLength).toBe(pcm.length);
    expect(Buffer.compare(wav.subarray(info.dataOffset), pcm)).toBe(0);
  });

  it('encodes 24-bit PCM', () => {
    const pcm = Buffer.from([0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]); // 2 个 24-bit 采样
    const wav = encodeWav(pcm, { sampleRate: 48000, channels: 1, bitsPerSample: 24 });
    const info = parseWav(wav);
    expect(info.format.bitsPerSample).toBe(24);
    expect(info.format.blockAlign).toBe(3);
    expect(info.durationSec).toBeCloseTo(2 / 48000, 6);
  });

  it('rejects unsupported bit depths', () => {
    expect(() => encodeWav(Buffer.alloc(4), { sampleRate: 8000, channels: 1, bitsPerSample: 8 }))
      .toThrow(WavParseError);
  });
});

describe('concatWavBuffers', () => {
  const mk = (n: number, sampleRate = 24000) =>
    buildWav({ pcm: makePcm16(new Array(n).fill(500)), sampleRate });

  it('concats same-format segments with silence gap', () => {
    const a = mk(2400); // 0.1s
    const b = mk(2400);
    const joined = concatWavBuffers([a, b], 0.05);
    const info = parseWav(joined);
    expect(info.format.sampleRate).toBe(24000);
    expect(info.dataLength).toBe((2400 + 1200 + 2400) * 2); // 0.1 + 0.05 + 0.1s
    // 间隙应为静音
    const gapStart = 44 + 2400 * 2;
    const gap = joined.subarray(gapStart, gapStart + 1200 * 2);
    expect(gap.every(byte => byte === 0)).toBe(true);
  });

  it('rejects mixing different sample rates', () => {
    expect(() => concatWavBuffers([mk(100, 24000), mk(100, 44100)])).toThrow(WavParseError);
  });

  it('rejects non-PCM input', () => {
    const floatWav = buildWav({ pcm: Buffer.alloc(100), formatTag: 3 });
    expect(() => concatWavBuffers([floatWav])).toThrow(WavParseError);
  });
});

describe('applySpeedToWav (parse-based)', () => {
  const sineWav = (sampleRate: number, seconds: number): Buffer => {
    const n = Math.floor(sampleRate * seconds);
    const pcm = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), i * 2);
    }
    // 加一个 LIST 块，验证不再依赖固定 44 字节头
    return buildWav({ pcm, sampleRate, preChunks: [{ id: 'LIST', payload: Buffer.alloc(9) }] });
  };

  it('returns input unchanged when speed ≈ 1', () => {
    const wav = sineWav(24000, 1);
    expect(applySpeedToWav(wav, 1.0)).toBe(wav);
  });

  it('shortens audio at speed > 1 and preserves real sample rate', () => {
    const wav = sineWav(44100, 2.0);
    const out = applySpeedToWav(wav, 1.5);
    const info = parseWav(out);
    expect(info.format.sampleRate).toBe(44100); // 旧实现会错误封成 24kHz
    expect(info.durationSec).toBeLessThan(1.7);
    expect(info.durationSec).toBeGreaterThan(1.1);
  });

  it('throws for non-16-bit-PCM input instead of silent passthrough', () => {
    const floatWav = buildWav({ pcm: Buffer.alloc(48000), formatTag: 3 });
    expect(() => applySpeedToWav(floatWav, 1.4)).toThrow(WavParseError);
  });

  it('downmixes stereo input to mono before stretching', () => {
    const pcm = Buffer.alloc(24000 * 2 * 2); // 24000 帧/声道 @24kHz = 1.0s 立体声
    for (let i = 0; i < 24000; i++) {
      const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 9000);
      pcm.writeInt16LE(v, i * 4);
      pcm.writeInt16LE(v, i * 4 + 2);
    }
    const wav = buildWav({ pcm, channels: 2 });
    const out = applySpeedToWav(wav, 1.2);
    const info = parseWav(out);
    expect(info.format.channels).toBe(1);
    expect(info.durationSec).toBeGreaterThan(0.7);
    expect(info.durationSec).toBeLessThan(0.95);
  });
});
