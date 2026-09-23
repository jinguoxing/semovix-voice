/**
 * 1. AI Speech Synthesis (TTS)
 * （自 server.ts 原样迁移）
 */
import { Router } from 'express';
import { resolveTtsAdapter } from '../engines/tts';
import { hasGeminiApiKey } from '../engines/geminiClient';

export const generateSpeechRouter = Router();

generateSpeechRouter.post('/generate-speech', async (req, res) => {
  try {
    const {
      text,
      voiceName = 'Kore',
      emotion,
      speed = 1.0,
      multiSpeaker = false,
      speakers = [],
      systemInstruction,
      temperature = 0.7,
      ttsModel = 'gemini-2.5-flash-preview-tts',
    } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text prompt is required.' });
    }

    if (ttsModel === 'web-speech-native') {
      return res.json({
        fallbackRequired: true,
        message: 'Client-side web speech selected.'
      });
    }

    const adapter = resolveTtsAdapter(ttsModel);

    if (adapter.requiresApiKey && !hasGeminiApiKey()) {
      return res.status(400).json({
        error: 'Gemini API key is not configured.',
        fallbackRequired: true
      });
    }

    const result = await adapter.synthesize({
      text,
      voiceName,
      ttsModel,
      emotion,
      systemInstruction,
      speed,
      temperature,
      multiSpeaker,
      speakers,
    });

    res.json({
      success: true,
      audioUrl: `data:audio/wav;base64,${result.wavBase64}`,
      duration: Math.max(1, result.duration),
      sampleRate: result.sampleRate,
      format: 'wav',
      voiceName: result.voiceName,
      engine: adapter.id,
    });
  } catch (error: any) {
    console.error('Speech generation error:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate speech.',
      fallbackRequired: true,
    });
  }
});
