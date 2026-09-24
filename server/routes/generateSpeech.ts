/**
 * 1. AI Speech Synthesis (TTS)
 * P2：模型白名单 + 统一错误结构；引擎不可用/未配置时如实失败，不再回退伪造。
 * P4：输出 WAV 落盘 artifacts 并返回 /api/artifacts/:id URL（硬性约束 #7：
 *     不再经 JSON Base64 回传大音频）；每次调用写入 generations 留痕（含失败）。
 */
import { Router } from 'express';
import { resolveTtsAdapter } from '../engines/tts';
import { hasGeminiApiKey } from '../engines/geminiClient';
import { EngineValidationError } from '../engines/errors';
import { fail } from './respond';
import { recordGeneration, writeArtifactFile } from '../db/generationsStore';

export const generateSpeechRouter = Router();

function generationId(): string {
  return `tts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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

    const genId = generationId();
    const inputText = String(text).slice(0, 2000);

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
        // 引擎侧业务校验失败（如非官方 Qwen speaker ID，硬性约束 #6）——客户端错误，不留引擎失败痕
        return fail(res, 400, e.message, e.code, e.details);
      }
      // 引擎调用失败：如实上报 502 + 留痕，不降级、不伪造音频（硬性约束 #1/#2）
      console.error(`TTS engine ${adapter.id} failed:`, e.message);
      recordGeneration({
        id: genId,
        kind: 'tts',
        engine: adapter.id,
        model: ttsModel,
        voice: voiceName,
        params: { emotion, speed, temperature, multiSpeaker },
        input_text: inputText,
        status: 'failed',
        error: String(e.message || 'tts failed').slice(0, 500),
      });
      return fail(res, 502, e.message || 'TTS engine call failed.', 'tts_engine_failed', { engine: adapter.id, generationId: genId });
    }

    const wav = Buffer.from(result.wavBase64, 'base64');
    const { size } = writeArtifactFile(genId, wav);

    recordGeneration({
      id: genId,
      kind: 'tts',
      engine: adapter.id,
      model: ttsModel,
      voice: result.voiceName,
      params: { emotion, speed, temperature, multiSpeaker, fileSize: size },
      input_text: inputText,
      output_file: `${genId}.wav`,
      duration_sec: result.duration,
      sample_rate: result.sampleRate,
      status: 'done',
    });

    res.json({
      success: true,
      audioUrl: `/api/artifacts/${genId}`,
      generationId: genId,
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
