/**
 * 本地转录引擎（Whisper-ASR Gradio 服务，端口 7861）
 * （自 server.ts 原样迁移；地址改为经 config 懒读取）
 */
import { getConfig } from '../config';
import { hasGeminiApiKey } from './geminiClient';

export const LOCAL_TRANSCRIBE_ID = 'whisper-local';

export async function whisperIsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getConfig().whisperAsrUrl}/gradio_api/info`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 上传 WAV 到 Gradio → 调 transcribe → SSE 等待完成，返回 [文本, 语言, 时长] */
export async function whisperTranscribe(wav: Buffer): Promise<{ transcript: string; language: string; duration: number }> {
  // 1. 文件上传
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
  const uploadRes = await fetch(`${getConfig().whisperAsrUrl}/gradio_api/upload`, { method: 'POST', body: form });
  if (!uploadRes.ok) throw new Error(`Whisper 服务上传失败 (HTTP ${uploadRes.status})，请确认已双击 Whisper-ASR「启动网页版.command」。`);
  const [serverPath] = (await uploadRes.json()) as string[];
  if (!serverPath) throw new Error('Whisper 服务未返回文件路径。');

  // 2. 提交转写（Gradio 5 要求文件输入包成 FileData 对象，裸路径会被 pydantic 拒绝）
  const submitRes = await fetch(`${getConfig().whisperAsrUrl}/gradio_api/call/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [{ path: serverPath, meta: { _type: 'gradio.FileData' } }, '自动'] }),
  });
  if (!submitRes.ok) throw new Error(`Whisper 服务提交失败 (HTTP ${submitRes.status})。`);
  const { event_id: eventId } = (await submitRes.json()) as { event_id?: string };
  if (!eventId) throw new Error('Whisper 服务未返回 event_id。');

  // 3. SSE 等待结果
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 600_000);
  try {
    const streamRes = await fetch(`${getConfig().whisperAsrUrl}/gradio_api/call/transcribe/${eventId}`, { signal: abort.signal });
    if (!streamRes.ok || !streamRes.body) throw new Error(`Whisper 结果流获取失败 (HTTP ${streamRes.status})。`);
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const errorMatch = buffer.match(/event:\s*error\s*\ndata:\s*(.*)\s*\n/);
      if (errorMatch) throw new Error(`Whisper 转写失败: ${errorMatch[1].slice(0, 200)}`);
      const completeMatch = buffer.match(/event:\s*complete\s*\ndata:\s*(\[.*\])\s*\n/);
      if (completeMatch) {
        const [transcript, language, duration] = JSON.parse(completeMatch[1]);
        return { transcript: String(transcript || ''), language: String(language || '自动'), duration: Number(duration) || 0 };
      }
    }
    throw new Error('Whisper 结果流在完成前中断。');
  } finally {
    clearTimeout(timer);
  }
}

/** 转录引擎路由：显式本地选择 → Whisper；有 key 且 gemini 模型 → 云端；否则 Whisper；再退回模拟 */
export async function resolveTranscribeEngine(preferredModel?: string): Promise<'whisper' | 'gemini' | 'fallback'> {
  if (preferredModel === LOCAL_TRANSCRIBE_ID) {
    return (await whisperIsAvailable()) ? 'whisper' : 'fallback';
  }
  if (hasGeminiApiKey() && (!preferredModel || preferredModel.startsWith('gemini'))) return 'gemini';
  if (await whisperIsAvailable()) return 'whisper';
  return hasGeminiApiKey() ? 'gemini' : 'fallback';
}
