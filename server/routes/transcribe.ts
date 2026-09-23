/**
 * 4. Audio Transcription & Analysis
 * （自 server.ts 原样迁移）
 */
import { Router } from 'express';
import { whisperTranscribe, resolveTranscribeEngine } from '../engines/asr';
import { ollamaIsAvailable, ollamaGenerateJson } from '../engines/reasoning';
import { getGeminiClient, hasGeminiApiKey } from '../engines/geminiClient';

export const transcribeRouter = Router();

transcribeRouter.post('/transcribe-audio', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/wav', transcribeModel = 'gemini-2.5-flash' } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required.' });
    }

    const engine = await resolveTranscribeEngine(transcribeModel);

    if (engine === 'whisper') {
      try {
        const clean = String(audioBase64).replace(/^data:audio\/[a-z0-9]+;base64,/, '');
        const wav = Buffer.from(clean, 'base64');
        const { transcript, duration } = await whisperTranscribe(wav);

        // 本地 LLM 顺手做摘要/情绪/标签（不可用时给保守兜底）
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
        console.warn('Whisper transcribe failed, fallback:', e.message);
        return res.status(502).json({
          error: e.message || '本地转录失败。',
          fallbackRequired: false,
        });
      }
    }

    if (!hasGeminiApiKey()) {
      return res.json({
        success: true,
        transcript: '（本地模式转录模拟：音频录制清晰，音色明亮，适合用作语音素材）',
        summary: '测试音频样本',
        mood: '清晰/平静',
        tags: ['录音', '人声', '原声'],
        engine: 'fallback',
      });
    }

    const cleanBase64 = audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
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
    res.json({ success: true, ...parsed });
  } catch (error: any) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: error.message || 'Transcription failed.' });
  }
});
