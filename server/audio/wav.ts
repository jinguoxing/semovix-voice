/**
 * WAV 封包辅助（自 server.ts 原样迁移）。
 * P1-c3 将替换为可靠 RIFF chunk 解析，去除固定 44 字节头假设。
 */

/**
 * Convert 16-bit PCM Buffer into standard RIFF WAV Buffer
 */
export function pcmToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export const QWEN_SAMPLE_RATE = 24000;

export function wavDuration(wav: Buffer): number {
  if (wav.length <= 44) return 0;
  const sampleRate = wav.readUInt32LE(24) || QWEN_SAMPLE_RATE;
  return Math.round(((wav.length - 44) / (sampleRate * 2)) * 10) / 10;
}

/** 拼接多段同格式 WAV（24kHz/16bit/单声道，44 字节头），段间可插入静音 */
export function concatWavBuffers(wavs: Buffer[], gapSeconds = 0): Buffer {
  const gapBytes = Math.round(gapSeconds * QWEN_SAMPLE_RATE) * 2;
  const chunks: Buffer[] = [];
  wavs.forEach((w, i) => {
    if (w.toString('ascii', 0, 4) !== 'RIFF') throw new Error('音频格式异常：非 RIFF/WAV 文件。');
    if (i > 0 && gapBytes > 0) chunks.push(Buffer.alloc(gapBytes));
    chunks.push(w.subarray(44));
  });
  return pcmToWavBuffer(Buffer.concat(chunks), QWEN_SAMPLE_RATE, 1, 16);
}
