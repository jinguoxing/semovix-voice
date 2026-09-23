import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Modality, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Google GenAI
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/**
 * Convert 16-bit PCM Buffer into standard RIFF WAV Buffer
 */
function pcmToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  // RIFF identifier
  header.write('RIFF', 0);
  // File size minus 8 bytes
  header.writeUInt32LE(36 + dataSize, 4);
  // RIFF type & format header
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  // Format chunk size (16 for PCM)
  header.writeUInt32LE(16, 16);
  // Audio format (1 = PCM)
  header.writeUInt16LE(1, 20);
  // Number of channels
  header.writeUInt16LE(numChannels, 22);
  // Sample rate
  header.writeUInt32LE(sampleRate, 24);
  // Byte rate
  header.writeUInt32LE(byteRate, 28);
  // Block align
  header.writeUInt16LE(blockAlign, 32);
  // Bits per sample
  header.writeUInt16LE(bitsPerSample, 34);
  // Data chunk header
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// -------------------------------------------------------------
// API Routes
// -------------------------------------------------------------

/**
 * 0. Voice Model Status & Configuration Info
 */
app.get('/api/voice-model/status', (req, res) => {
  res.json({
    status: apiKey ? 'connected' : 'local_fallback',
    configured: Boolean(apiKey),
    engine: 'Google Gemini Audio Multimodal',
    models: {
      tts: 'gemini-3.1-flash-tts-preview',
      transcribe: 'gemini-3.5-transcribe',
      reasoning: 'gemini-3.8-flash',
    },
    supportedVoices: [
      { id: 'Kore', name: 'Kore', gender: '男声', title: '权威男中音', tag: '沉稳睿智' },
      { id: 'Puck', name: 'Puck', gender: '男声', title: '朝气男高音', tag: '活力轻快' },
      { id: 'Fenrir', name: 'Fenrir', gender: '男声', title: '电影级重低音', tag: '磁性厚重' },
      { id: 'Charon', name: 'Charon', gender: '男声', title: '播音级标准音', tag: '专业播报' },
      { id: 'Zephyr', name: 'Zephyr', gender: '女声', title: '知性疗愈女声', tag: '温暖知性' },
    ],
    sampleRate: 24000,
    container: 'WAV (RIFF Header, 16-bit PCM)',
  });
});

/**
 * 1. AI Speech Synthesis (TTS)
 */
app.post('/api/generate-speech', async (req, res) => {
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
      ttsModel = 'gemini-3.1-flash-tts-preview',
    } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text prompt is required.' });
    }

    if (!apiKey) {
      return res.status(400).json({ 
        error: 'Gemini API key is not configured.',
        fallbackRequired: true 
      });
    }

    let speechPrompt = text;
    if (emotion) {
      speechPrompt = `Speak with an emotion and tone of [${emotion}]: ${text}`;
    }

    // Determine target TTS model from request
    let targetModel = ttsModel || 'gemini-3.1-flash-tts-preview';
    if (targetModel === 'web-speech-native') {
      return res.json({
        fallbackRequired: true,
        message: 'Client-side web speech selected.'
      });
    }

    const tempValue = Math.max(0.1, Math.min(1.5, Number(temperature) || 0.7));

    let response;
    if (multiSpeaker && Array.isArray(speakers) && speakers.length >= 2) {
      response = await ai.models.generateContent({
        model: targetModel,
        contents: [{ parts: [{ text: speechPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          temperature: tempValue,
          ...(systemInstruction ? { systemInstruction } : {}),
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                {
                  speaker: speakers[0].speaker || 'Speaker1',
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: speakers[0].voiceName || 'Kore' },
                  },
                },
                {
                  speaker: speakers[1].speaker || 'Speaker2',
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: speakers[1].voiceName || 'Puck' },
                  },
                },
              ],
            },
          },
        },
      });
    } else {
      response = await ai.models.generateContent({
        model: targetModel,
        contents: [{ parts: [{ text: speechPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          temperature: tempValue,
          ...(systemInstruction ? { systemInstruction } : {}),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
            },
          },
        },
      });
    }

    const candidate = response.candidates?.[0];
    const audioPart = candidate?.content?.parts?.find(p => p.inlineData?.data);

    if (!audioPart || !audioPart.inlineData?.data) {
      throw new Error('No audio returned by speech synthesis model.');
    }

    const rawData = audioPart.inlineData.data;
    const mimeType = audioPart.inlineData.mimeType || 'audio/pcm';

    // If it's raw PCM, wrap into WAV container
    let wavBase64 = rawData;
    if (mimeType.includes('pcm') || !mimeType.includes('wav')) {
      const pcmBuffer = Buffer.from(rawData, 'base64');
      const wavBuffer = pcmToWavBuffer(pcmBuffer, 24000, 1, 16);
      wavBase64 = wavBuffer.toString('base64');
    }

    const audioDataUrl = `data:audio/wav;base64,${wavBase64}`;
    const pcmBytes = Buffer.from(rawData, 'base64');
    const estimatedDuration = Math.round((pcmBytes.length / (24000 * 2)) * 10) / 10;

    res.json({
      success: true,
      audioUrl: audioDataUrl,
      duration: Math.max(1, estimatedDuration),
      sampleRate: 24000,
      format: 'wav',
      voiceName,
    });
  } catch (error: any) {
    console.error('Speech generation error:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate speech.',
      fallbackRequired: true,
    });
  }
});

/**
 * 2. Sound Effect (SFX) Recipe Generation
 */
app.post('/api/generate-sound-recipe', async (req, res) => {
  try {
    const { prompt, category = 'sci-fi', reasoningModel = 'gemini-3.8-flash' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Sound prompt is required.' });
    }

    if (!apiKey) {
      // Fallback default recipe
      return res.json({
        success: true,
        recipe: {
          title: prompt,
          description: `基于提示词 “${prompt}” 生成的程序化音效`,
          category: category || 'sfx',
          duration: 1.2,
          oscillators: [
            { type: 'sawtooth', startFreq: 440, endFreq: 110, freqRamp: 'exponential', gain: 0.7 },
            { type: 'sine', startFreq: 220, endFreq: 55, freqRamp: 'exponential', gain: 0.5 },
          ],
          envelope: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 0.5 },
          filter: { type: 'lowpass', startCutoff: 3000, endCutoff: 400, q: 4 },
          noise: { type: 'white', gain: 0.15, duration: 0.3 },
          effects: { reverb: 0.3, distortion: 0.1 },
        },
      });
    }

    const modelToUse = reasoningModel || 'gemini-3.8-flash';

    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: `You are an expert audio sound designer and synthesizer programmer.
Create a Web Audio API procedural synthesis recipe for the following sound description: "${prompt}" (Category: ${category}).
Provide precise oscillator frequencies, envelopes, filter curves, and noise parameters that faithfully create this sound.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { type: Type.STRING },
            duration: { type: Type.NUMBER, description: 'Duration in seconds between 0.3 and 5.0' },
            oscillators: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ['sine', 'square', 'sawtooth', 'triangle'] },
                  startFreq: { type: Type.NUMBER },
                  endFreq: { type: Type.NUMBER },
                  freqRamp: { type: Type.STRING, enum: ['linear', 'exponential', 'none'] },
                  detune: { type: Type.NUMBER },
                  gain: { type: Type.NUMBER },
                },
                required: ['type', 'startFreq', 'gain'],
              },
            },
            envelope: {
              type: Type.OBJECT,
              properties: {
                attack: { type: Type.NUMBER },
                decay: { type: Type.NUMBER },
                sustain: { type: Type.NUMBER },
                release: { type: Type.NUMBER },
              },
              required: ['attack', 'decay', 'sustain', 'release'],
            },
            filter: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['lowpass', 'highpass', 'bandpass'] },
                startCutoff: { type: Type.NUMBER },
                endCutoff: { type: Type.NUMBER },
                q: { type: Type.NUMBER },
              },
            },
            noise: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['white', 'pink', 'brown'] },
                gain: { type: Type.NUMBER },
                duration: { type: Type.NUMBER },
              },
            },
            effects: {
              type: Type.OBJECT,
              properties: {
                distortion: { type: Type.NUMBER },
                reverb: { type: Type.NUMBER },
              },
            },
          },
          required: ['title', 'description', 'category', 'duration', 'oscillators', 'envelope'],
        },
      },
    });

    const jsonText = response.text?.trim() || '{}';
    const recipe = JSON.parse(jsonText);

    res.json({ success: true, recipe });
  } catch (error: any) {
    console.error('SFX recipe error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate sound recipe.' });
  }
});

/**
 * 3. AI Beat & Melody Pattern Generation
 */
app.post('/api/generate-music-pattern', async (req, res) => {
  try {
    const { prompt = 'Lo-Fi Chill Beat', bpm = 90, scale = 'C Minor', reasoningModel = 'gemini-3.8-flash' } = req.body;

    if (!apiKey) {
      // Default fallback pattern
      return res.json({
        success: true,
        pattern: {
          name: prompt,
          bpm: bpm || 90,
          scale: scale || 'C Minor',
          tracks: [
            { id: 't1', name: 'Kick Drum', soundType: 'kick', steps: [true, false, false, false, true, false, false, false, true, false, false, false, false, false, true, false], volume: 0.9 },
            { id: 't2', name: 'Snare / Clap', soundType: 'snare', steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false], volume: 0.8 },
            { id: 't3', name: 'Closed Hi-Hat', soundType: 'hihat', steps: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], volume: 0.6 },
            { id: 't4', name: 'Sub Bass', soundType: 'bass', steps: [true, false, false, false, false, true, false, false, true, false, false, false, false, true, false, false], notes: ['C2', null, null, null, null, 'Eb2', null, null, 'F2', null, null, null, null, 'G2', null, null], volume: 0.8 },
            { id: 't5', name: 'Synth Chords/Lead', soundType: 'lead', steps: [true, false, false, true, false, false, true, false, false, true, false, false, true, false, false, false], notes: ['C4', null, null, 'Eb4', null, null, 'G4', null, null, 'Bb4', null, null, 'C5', null, null, null], volume: 0.7 },
          ],
        },
      });
    }

    const modelToUse = reasoningModel || 'gemini-3.8-flash';

    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: `You are a talented electronic music producer. Generate a 16-step musical beat pattern based on the prompt: "${prompt}".
Target BPM: ${bpm}, Target Scale: ${scale}.
Return exactly 5 tracks: Kick Drum, Snare / Clap, Hi-Hat, Sub Bass, and Synth Lead/Pluck.
Each track must have an array of 16 booleans for 'steps', and for Bass and Lead, an optional array of 16 note strings (e.g. "C2", "Eb2", "G2" or null).`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            bpm: { type: Type.NUMBER },
            scale: { type: Type.STRING },
            tracks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  name: { type: Type.STRING },
                  soundType: { type: Type.STRING, enum: ['kick', 'snare', 'hihat', 'bass', 'lead'] },
                  steps: {
                    type: Type.ARRAY,
                    items: { type: Type.BOOLEAN },
                    description: 'Exactly 16 boolean values indicating step triggers',
                  },
                  notes: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING, nullable: true },
                    description: '16 elements with note names (like C2, Eb2, G3) or null',
                  },
                  volume: { type: Type.NUMBER },
                },
                required: ['id', 'name', 'soundType', 'steps', 'volume'],
              },
            },
          },
          required: ['name', 'bpm', 'scale', 'tracks'],
        },
      },
    });

    const jsonText = response.text?.trim() || '{}';
    const pattern = JSON.parse(jsonText);

    res.json({ success: true, pattern });
  } catch (error: any) {
    console.error('Music pattern error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate beat pattern.' });
  }
});

/**
 * 4. Audio Transcription & Analysis
 */
app.post('/api/transcribe-audio', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/wav', transcribeModel = 'gemini-3.5-transcribe' } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required.' });
    }

    if (!apiKey) {
      return res.json({
        success: true,
        transcript: '（本地模式转录模拟：音频录制清晰，音色明亮，适合用作语音素材）',
        summary: '测试音频样本',
        mood: '清晰/平静',
        tags: ['录音', '人声', '原声'],
      });
    }

    const cleanBase64 = audioBase64.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
    const modelToUse = transcribeModel || 'gemini-3.5-transcribe';

    const response = await ai.models.generateContent({
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

/**
 * 5. Auto-Tag and Categorization
 */
app.post('/api/auto-tag-audio', async (req, res) => {
  try {
    const { title, description, category, transcript } = req.body;

    if (!apiKey) {
      return res.json({
        tags: ['高清音质', '素材', category || '音频'],
        category: category || 'sample',
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: `Given the following audio metadata:
Title: ${title}
Description: ${description || ''}
Category: ${category}
Transcript: ${transcript || ''}

Generate 4-6 concise, useful Chinese tags for library search and organization (e.g. "科技感", "低音轰鸣", "快节奏", "游戏UI", "热情解说").`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            refinedDescription: { type: Type.STRING },
          },
          required: ['tags'],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json({ success: true, tags: parsed.tags || [], description: parsed.refinedDescription });
  } catch (error: any) {
    console.error('Auto tag error:', error);
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// Vite Dev Server or Production Static Serving
// -------------------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AudioCraft Studio running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
