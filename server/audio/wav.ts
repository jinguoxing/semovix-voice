/**
 * 可靠 RIFF/WAV 解析与封包。
 *
 * 取代旧版“固定 44 字节头”假设：真实世界的 WAV 常带 LIST/JUNK 等附加块、
 * WAVE_FORMAT_EXTENSIBLE 扩展 fmt 块、以及流式写入导致的 data 长度占位
 * （0xFFFFFFFF 或越界值）。本模块按 RIFF 规范遍历 chunk，逐块定位 fmt 与 data。
 */

export type WavCodec = 'pcm' | 'float' | 'adpcm' | 'mulaw' | 'alaw' | 'extensible' | 'unknown';

export interface WavFormat {
  /** 规范化后的编码：1=PCM, 3=IEEE float, 0xFFFE=extensible（已解析子格式） */
  audioFormat: number;
  /** fmt 块中原始 format tag（extensible 时保留 0xFFFE 便于诊断） */
  rawFormatTag: number;
  codec: WavCodec;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
}

export interface ParsedWav {
  format: WavFormat;
  /** data 块净荷在文件中的绝对字节偏移 */
  dataOffset: number;
  /** 实际可用的 data 字节数（声明值越界时按文件长度钳制） */
  dataLength: number;
  /** data 块头里声明的大小（可能为 0xFFFFFFFF 等占位值，仅诊断用） */
  declaredDataLength: number;
  durationSec: number;
}

export class WavParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavParseError';
  }
}

function codecOf(formatTag: number): WavCodec {
  switch (formatTag) {
    case 0x0001: return 'pcm';
    case 0x0003: return 'float';
    case 0x0011: return 'adpcm';
    case 0x0006: return 'mulaw';
    case 0x0007: return 'alaw';
    case 0xFFFE: return 'extensible';
    default: return 'unknown';
  }
}

/**
 * 解析 WAV 文件头与块结构。不读取/校验采样数据本身。
 * @throws WavParseError 非 RIFF/WAVE 结构、缺 fmt 或缺 data 块
 */
export function parseWav(buf: Buffer): ParsedWav {
  if (buf.length < 12) throw new WavParseError('WAV 太短，不足 RIFF 头（<12 字节）。');
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new WavParseError('非 RIFF 文件（magic 不匹配）。');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new WavParseError('RIFF 类型不是 WAVE。');

  let fmt: WavFormat | null = null;
  let dataOffset = -1;
  let declaredDataLength = 0;
  let dataLength = 0;

  let pos = 12;
  while (pos + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);
    const payloadStart = pos + 8;
    const payloadAvailable = buf.length - payloadStart;
    const payloadLength = Math.min(chunkSize, payloadAvailable);

    if (chunkId === 'fmt ') {
      if (payloadLength < 16) throw new WavParseError('fmt 块过小（<16 字节），不是合法 WAV。');
      const rawFormatTag = buf.readUInt16LE(payloadStart);
      let audioFormat = rawFormatTag;
      // WAVE_FORMAT_EXTENSIBLE：真实格式在 fmt 块尾部 SubFormat GUID 的前 2 字节
      if (rawFormatTag === 0xFFFE && payloadLength >= 40) {
        audioFormat = buf.readUInt16LE(payloadStart + 24);
      }
      fmt = {
        audioFormat,
        rawFormatTag,
        codec: rawFormatTag === 0xFFFE ? codecOf(audioFormat) : codecOf(rawFormatTag),
        channels: buf.readUInt16LE(payloadStart + 2),
        sampleRate: buf.readUInt32LE(payloadStart + 4),
        byteRate: buf.readUInt32LE(payloadStart + 8),
        blockAlign: buf.readUInt16LE(payloadStart + 12),
        bitsPerSample: buf.readUInt16LE(payloadStart + 14),
      };
    } else if (chunkId === 'data') {
      // 流式写入的 WAV 常把 data 长度写为 0xFFFFFFFF 占位或干脆写错，按实际文件钳制
      dataOffset = payloadStart;
      declaredDataLength = chunkSize;
      dataLength = payloadLength;
      if (chunkSize > payloadAvailable) break; // 后面已无完整块可遍历
    }

    // RIFF 块按 2 字节对齐：奇数长度补 1 字节 pad
    pos = payloadStart + payloadLength + (chunkSize & 1);
  }

  if (!fmt) throw new WavParseError('未找到 fmt 块。');
  if (dataOffset < 0) throw new WavParseError('未找到 data 块。');
  if (fmt.channels < 1 || fmt.sampleRate < 1 || fmt.blockAlign < 1) {
    throw new WavParseError(`fmt 块参数非法: channels=${fmt.channels} sampleRate=${fmt.sampleRate} blockAlign=${fmt.blockAlign}`);
  }

  const durationSec = dataLength / fmt.byteRate;
  return { format: fmt, dataOffset, dataLength, declaredDataLength, durationSec };
}

/**
 * 提取 16-bit PCM 数据块（供 WSOLA/拼接等仅支持 16bit PCM 的处理使用）。
 * @throws WavParseError 非 16-bit PCM 编码
 */
export function extractPcm16(buf: Buffer): { pcm: Buffer; info: ParsedWav } {
  const info = parseWav(buf);
  const { audioFormat, bitsPerSample } = info.format;
  if (audioFormat !== 0x0001 || bitsPerSample !== 16) {
    throw new WavParseError(
      `仅支持 16-bit PCM，实际为 format=0x${audioFormat.toString(16)} bits=${bitsPerSample}。`
    );
  }
  return { pcm: buf.subarray(info.dataOffset, info.dataOffset + info.dataLength), info };
}

export interface EncodeWavOptions {
  sampleRate: number;
  channels: number;
  bitsPerSample: number; // 16 | 24（32-bit float 留待母带实施包）
}

/** 把 PCM 字节流封包为规范 WAV（仅支持整数 PCM 16/24-bit）。 */
export function encodeWav(pcm: Buffer, opts: EncodeWavOptions): Buffer {
  const { sampleRate, channels, bitsPerSample } = opts;
  if (bitsPerSample !== 16 && bitsPerSample !== 24) {
    throw new WavParseError(`不支持的位深: ${bitsPerSample}（当前支持 16/24-bit PCM）。`);
  }
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/** 兼容旧调用方：16-bit PCM 封包。 */
export function pcmToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  return encodeWav(pcmBuffer, { sampleRate, channels: numChannels, bitsPerSample });
}

/** 解析式时长计算（秒，保留 1 位小数，与旧实现口径一致）。 */
export function wavDuration(wav: Buffer): number {
  try {
    return Math.round(parseWav(wav).durationSec * 10) / 10;
  } catch {
    return 0;
  }
}

/**
 * 拼接多段同格式 WAV，段间插入静音。
 * 逐段解析校验（格式一致且为 16-bit PCM），拒绝混合采样率/位深拼接。
 */
export function concatWavBuffers(wavs: Buffer[], gapSeconds = 0): Buffer {
  if (wavs.length === 0) throw new WavParseError('拼接列表为空。');
  const parsed = wavs.map(w => extractPcm16(w));
  const first = parsed[0].info.format;
  for (const { info } of parsed) {
    const f = info.format;
    if (f.sampleRate !== first.sampleRate || f.channels !== first.channels || f.bitsPerSample !== first.bitsPerSample) {
      throw new WavParseError(
        `拼接段格式不一致: ${f.sampleRate}Hz/${f.bitsPerSample}bit/${f.channels}ch vs ` +
        `${first.sampleRate}Hz/${first.bitsPerSample}bit/${first.channels}ch。`
      );
    }
  }
  const blockAlign = first.blockAlign;
  const gapBytes = Math.round(gapSeconds * first.sampleRate) * blockAlign;
  const chunks: Buffer[] = [];
  parsed.forEach(({ pcm }, i) => {
    if (i > 0 && gapBytes > 0) chunks.push(Buffer.alloc(gapBytes));
    chunks.push(pcm);
  });
  return encodeWav(Buffer.concat(chunks), {
    sampleRate: first.sampleRate,
    channels: first.channels,
    bitsPerSample: first.bitsPerSample,
  });
}
