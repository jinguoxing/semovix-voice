/**
 * 1. AI Speech Synthesis (TTS)
 * P2：模型白名单 + 统一错误结构；引擎不可用/未配置时如实失败，不再回退伪造。
 */
import { Router } from 'express';
import { resolveTtsAdapter } from '../engines/tts';
import { hasGeminiApiKey } from '../engines/geminiClient';
import { EngineValidationError } from '../engines/errors';
import { fail } from './respond';

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
      return fail(res, 400, 'Text prompt is required.', 'invalid_request');
    }

    if (ttsModel === 'web-speech-native') {
      // 已知特例：浏览器本地合成只做实时预览，服务端不产出可交付音频（如实告知，不伪造）
      return res.json({
        fallbackRequired: true,
        message: '已选择浏览器本地合成（web-speech-native）：该模式仅供浏览器实时预览，不会生成可保存/交付的音频。请选择 Gemini TTS 或本地 Qwen3-TTS。',
      });
    }

    let adapter;
    try {
      adapter = resolveTtsAdapter(ttsModel);
    } catch (e) {
      if (e instanceof EngineValidationError) {
        return fail(res, 400, e.message, e.code, e.details); // e.g. unsupported_tts_model / unsupported_speaker
      }
      throw e;
    }

    if (adapter.requiresApiKey && !hasGeminiApiKey()) {
      return fail(res, 400, 'Gemini API key is not configured.', 'engine_not_configured', { engine: adapter.id });
    }

    let result;
    try {
      result = await adapter.synthesize({
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
    } catch (e: any) {
      if (e instanceof EngineValidationError) {
        // 引擎侧业务校验失败（如非官方 Qwen speaker ID，硬性约束 #6）
        return fail(res, 400, e.message, e.code, e.details);
      }
      // 引擎调用失败：如实上报 502，不降级、不伪造音频（硬性约束 #1/#2）
      console.error(`TTS engine ${adapter.id} failed:`, e.message);
      return fail(res, 502, e.message || 'TTS engine call failed.', 'tts_engine_failed', { engine: adapter.id });
    }

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
    return fail(res, 500, error.message || 'Failed to generate speech.', 'internal_error');
  }
});
