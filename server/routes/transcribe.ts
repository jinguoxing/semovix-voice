/**
 * 4. Audio Transcription & Analysis
 * P4：音频上传改 multipart 文件（硬性约束 #7：大音频不得 JSON Base64 传输）；
 *     每次调用写入 generations 留痕（含失败）。
 */
import { Router } from 'express';
import multer from 'multer';
import {
  whisperTranscribe,
  resolveTranscribeEngine,
  SUPPORTED_TRANSCRIBE_MODELS,
  isSupportedTranscribeModel,
} from '../engines/asr';
import { ollamaIsAvailable, ollamaGenerateJson } from '../engines/reasoning';
import { getGeminiClient, hasGeminiApiKey } from '../engines/geminiClient';
import { WorkerNotReadyError } from '../engines/qwenWorker';
import { fail } from './respond';
import { describeError } from '../engines/errors';
import { recordGeneration } from '../db/generationsStore';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

function generationId(): string {
  return `asr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const transcribeRouter = Router();

transcribeRouter.post('/transcribe-audio', upload.single('audio'), async (req, res) => {
  try {
    const transcribeModel = String(req.body?.transcribeModel || 'gemini-2.5-flash');
    const language = ['auto', 'zh', 'en'].includes(String(req.body?.language)) ? String(req.body.language) as 'auto' | 'zh' | 'en' : 'auto';

    if (req.body?.audioBase64) {
      return fail(res, 400, 'JSON Base64 传输已停用：请以 multipart/form-data 上传音频文件（字段名 audio）。', 'unsupported_transport');
    }
    if (!req.file || req.file.buffer.length === 0) {
      return fail(res, 400, 'Audio file is required (multipart/form-data, field "audio").', 'invalid_request');
    }

    // 模型白名单先于一切引擎探测：未知 ID 直接拒绝，绝不转发给 Gemini（硬性约束 #4）
    if (!isSupportedTranscribeModel(transcribeModel)) {
      return fail(res, 400, `不支持的转录模型 ID: ${transcribeModel}（支持: ${SUPPORTED_TRANSCRIBE_MODELS.join(', ')}）`, 'unsupported_transcribe_model', {
        supportedModels: SUPPORTED_TRANSCRIBE_MODELS,
      });
    }

    const engine = await resolveTranscribeEngine(transcribeModel);

    if (engine === 'fallback') {
      // 无可用引擎：如实失败（硬性约束 #3：不得写入模拟转录文本）
      return fail(
        res,
        503,
        '没有可用的转录引擎：本地 Whisper（Worker）未启动，且未配置 Gemini API key。请先启动 worker/「启动Worker.command」或配置 API key 后重试。',
        'engine_unavailable'
      );
    }

    const genId = generationId();

    if (engine === 'whisper') {
      try {
        const wav = req.file.buffer;
        const { transcript, duration } = await whisperTranscribe(wav, language);

        // 本地 LLM 顺手做摘要/情绪/标签（不可用时给保守兜底——仅元数据，不涉及转录文本伪造）
        let summary = '本地 Whisper 转录结果';
        let mood = '清晰';
        let tags: string[] = ['转录', '人声'];
        if (await ollamaIsAvailable()) {
          try {
            const meta = await ollamaGenerateJson(
              `下面是一段音频的文字稿。请用一句话总结内容、判断整体情绪基调，并给出 3-5 个简洁的中文标签。\n文字稿：${transcript.slice(0, 800) || '（空）'}`,
              {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  mood: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
                required: ['summary', 'mood', 'tags'],
              }
            );
            summary = meta.summary || summary;
            mood = meta.mood || mood;
            tags = Array.isArray(meta.tags) && meta.tags.length ? meta.tags : tags;
          } catch (e: any) {
            console.warn('Ollama 转录后处理失败，使用兜底:', e.message);
          }
        }

        recordGeneration({
          id: genId,
          kind: 'asr',
          engine: 'whisper-local',
          model: 'whisper-large-v3-turbo',
          params: { language, fileSize: wav.length },
          input_text: transcript,
          duration_sec: duration,
          status: 'done',
        });

        return res.json({ success: true, transcript, summary, mood, tags, duration, engine: 'whisper-local', generationId: genId });
      } catch (e: any) {
        if (e instanceof WorkerNotReadyError) {
          // 冷启动/加载失败/等待超时：如实 503（引擎尚未被真正调用，不留引擎失败痕，P01）
          const { engine: workerEngine, ...details } = e.details;
          return fail(res, 503, e.message, e.code, { engine: 'whisper-local', ...(workerEngine ? { workerEngine } : {}), ...details });
        }
        console.warn('Whisper transcribe failed:', e);
        const described = describeError(e);
        recordGeneration({
          id: genId,
          kind: 'asr',
          engine: 'whisper-local',
          model: 'whisper-large-v3-turbo',
          params: { language },
          status: 'failed',
          error: described.slice(0, 500),
        });
        return fail(res, 502, described || '本地转录失败。', 'asr_engine_failed', { engine: 'whisper-local' });
      }
    }

    // engine === 'gemini'（resolveTranscribeEngine 保证此时必有 API key）
    if (!hasGeminiApiKey()) {
      return fail(res, 400, 'Gemini API key is not configured.', 'engine_not_configured', { engine: 'gemini' });
    }

    const mimeType = req.file.mimetype || 'audio/wav';
    const cleanBase64 = req.file.buffer.toString('base64');

    const response = await getGeminiClient().models.generateContent({
      model: transcribeModel,
      contents: [
        {
          inlineData: {
            mimeType: mimeType.split(';')[0],
            data: cleanBase64,
          },
        },
        {
          text: `Please transcribe this audio accurately. Also identify the emotional mood and extract 4-6 descriptive tags.
Output your response in JSON with:
{
  "transcript": "Exact transcription text",
  "summary": "1 sentence brief summary",
  "mood": "Detected mood or tone",
  "tags": ["tag1", "tag2", "tag3"]
}`,
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    if (!parsed.transcript) {
      // 模型未返回文字稿：如实失败，不落库任何模拟文本（硬性约束 #3）
      recordGeneration({ id: genId, kind: 'asr', engine: 'gemini', model: transcribeModel, params: { language }, status: 'failed', error: 'empty transcript from gemini' });
      return fail(res, 502, '转录引擎未返回文字稿。', 'asr_engine_failed', { engine: 'gemini' });
    }
    recordGeneration({
      id: genId,
      kind: 'asr',
      engine: 'gemini',
      model: transcribeModel,
      params: { language },
      input_text: String(parsed.transcript),
      status: 'done',
    });
    res.json({ success: true, generationId: genId, ...parsed });
  } catch (error: any) {
    console.error('Transcription error:', error);
    return fail(res, 500, error.message || 'Transcription failed.', 'internal_error');
  }
});
