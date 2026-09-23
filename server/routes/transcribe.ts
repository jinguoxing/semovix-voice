/**
 * 4. Audio Transcription & Analysis
 * P2：删除模拟转录兜底（硬性约束 #3）——无可用引擎时返回 503 engine_unavailable，
 * 响应中不含任何伪造 transcript；转录模型 ID 走白名单（#4）。
 */
import { Router } from 'express';
import {
  whisperTranscribe,
  resolveTranscribeEngine,
  SUPPORTED_TRANSCRIBE_MODELS,
  isSupportedTranscribeModel,
} from '../engines/asr';
import { ollamaIsAvailable, ollamaGenerateJson } from '../engines/reasoning';
import { getGeminiClient, hasGeminiApiKey } from '../engines/geminiClient';
import { fail } from './respond';

export const transcribeRouter = Router();

transcribeRouter.post('/transcribe-audio', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/wav', transcribeModel = 'gemini-2.5-flash' } = req.body;

    if (!audioBase64) {
      return fail(res, 400, 'Audio data is required.', 'invalid_request');
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
        '没有可用的转录引擎：本地 Whisper 服务未启动，且未配置 Gemini API key。请先启动 Whisper-ASR 服务（双击「启动网页版.command」）或配置 API key 后重试。',
        'engine_unavailable'
      );
    }

    if (engine === 'whisper') {
      try {
        const clean = String(audioBase64).replace(/^data:audio\/[a-z0-9]+;base64,/, '');
        const wav = Buffer.from(clean, 'base64');
        const { transcript, duration } = await whisperTranscribe(wav);

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

        return res.json({ success: true, transcript, summary, mood, tags, duration, engine: 'whisper-local' });
      } catch (e: any) {
        console.warn('Whisper transcribe failed:', e.message);
        return fail(res, 502, e.message || '本地转录失败。', 'asr_engine_failed', { engine: 'whisper-local' });
      }
    }

    // engine === 'gemini'（resolveTranscribeEngine 保证此时必有 API key）
    if (!hasGeminiApiKey()) {
      return fail(res, 400, 'Gemini API key is not configured.', 'engine_not_configured', { engine: 'gemini' });
    }

    const cleanBase64 = String(audioBase64).replace(/^data:audio\/[a-z0-9]+;base64,/, '');
    const modelToUse = transcribeModel || 'gemini-2.5-flash';

    const response = await getGeminiClient().models.generateContent({
      model: modelToUse,
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
      return fail(res, 502, '转录引擎未返回文字稿。', 'asr_engine_failed', { engine: 'gemini' });
    }
    res.json({ success: true, ...parsed });
  } catch (error: any) {
    console.error('Transcription error:', error);
    return fail(res, 500, error.message || 'Transcription failed.', 'internal_error');
  }
});
