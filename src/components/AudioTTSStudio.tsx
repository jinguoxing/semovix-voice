import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  Sparkles, 
  Play, 
  Pause, 
  Download, 
  FolderPlus, 
  Scissors, 
  RefreshCw, 
  Volume2, 
  Users, 
  User, 
  Check,
  FileCheck,
  Sliders,
  Cpu,
  AlertTriangle
} from 'lucide-react';
import { AudioItem, AudioFolder } from '../types/audio';
import { getVoiceModelConfig, VoiceModelConfig } from '../utils/voiceModelConfig';

interface AudioTTSStudioProps {
  folders: AudioFolder[];
  onSaveToLibrary: (item: AudioItem, blob?: Blob) => void;
  onOpenEditor: (item: AudioItem) => void;
  onOpenVoiceModelConfig?: () => void;
}

/** Google Gemini 官方 Voice ID（硬性约束 #5：仅用于 gemini 引擎，绝不发给 Qwen） */
const GEMINI_VOICES = [
  { id: 'Kore', name: 'Kore', tag: '沉稳睿智', desc: '权威有深度的男中音，适合纪录片、科技发布与讲座', gender: '男声' },
  { id: 'Puck', name: 'Puck', tag: '活力轻快', desc: '热情朝气的高频男声，适合播客、短视频与广告推广', gender: '男声' },
  { id: 'Fenrir', name: 'Fenrir', tag: '磁性厚重', desc: '极具穿透力与叙事感的电影级重低音声线', gender: '男声' },
  { id: 'Charon', name: 'Charon', tag: '专业播报', desc: '咬字清晰干练的播音级声线，适合新闻与商业报告', gender: '男声' },
  { id: 'Zephyr', name: 'Zephyr', tag: '温暖知性', desc: '柔和细腻充满共情力的声线，适合有声书与冥想伴读', gender: '女声' },
];

export const AudioTTSStudio: React.FC<AudioTTSStudioProps> = ({
  folders,
  onSaveToLibrary,
  onOpenEditor,
  onOpenVoiceModelConfig,
}) => {
  const [modelConfig, setModelConfig] = useState<VoiceModelConfig>(getVoiceModelConfig());
  const [mode, setMode] = useState<'single' | 'dialogue'>('single');
  const [text, setText] = useState('欢迎来到未来声音实验室。在这里，每一段文字都可以转化为极具表现力与情感张力的声音艺术。');
  const [selectedVoice, setSelectedVoice] = useState(modelConfig.defaultVoice || 'Kore');
  const [selectedEmotion, setSelectedEmotion] = useState(modelConfig.defaultEmotion || '沉稳专业');
  
  // Dialogue mode state
  const [speaker1Voice, setSpeaker1Voice] = useState(modelConfig.dialogueSpeaker1?.voice || 'Kore');
  const [speaker2Voice, setSpeaker2Voice] = useState(modelConfig.dialogueSpeaker2?.voice || 'Puck');
  const [dialogueText, setDialogueText] = useState(
`主持人: 欢迎收听前沿探索，今天我们聊聊生成式音频技术。
嘉宾: 是的！如今声音合成不仅更加拟真，更赋予了创作者无限的想象空间。`
  );

  // Sync with global voice model configuration updates
  useEffect(() => {
    const handleConfigUpdate = (e: any) => {
      const newConfig: VoiceModelConfig = e.detail || getVoiceModelConfig();
      setModelConfig(newConfig);
      setSelectedVoice(newConfig.defaultVoice);
      setSelectedEmotion(newConfig.defaultEmotion);
      if (newConfig.dialogueSpeaker1?.voice) setSpeaker1Voice(newConfig.dialogueSpeaker1.voice);
      if (newConfig.dialogueSpeaker2?.voice) setSpeaker2Voice(newConfig.dialogueSpeaker2.voice);
    };

    window.addEventListener('voice-model-config-updated', handleConfigUpdate);
    return () => window.removeEventListener('voice-model-config-updated', handleConfigUpdate);
  }, []);

  // 硬性约束 #5/#6：Qwen 官方音色目录来自 /api/voice-model/status（Worker 模型运行时），
  // 与 Google Voice 目录彻底分开；Worker 未启动时如实为空
  const [qwenVoices, setQwenVoices] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    fetch('/api/voice-model/status')
      .then(r => r.json())
      .then(d => setQwenVoices(d?.voices?.qwen3Tts ?? []))
      .catch(() => setQwenVoices([]));
  }, []);

  const isQwenEngine = modelConfig.ttsModel === 'qwen3-tts-local';
  const voiceOptions = isQwenEngine
    ? qwenVoices.map(v => ({
        id: v.id,
        name: v.name,
        tag: '官方ID',
        desc: 'Qwen3-TTS 官方音色（来自引擎运行时目录，ID 精确匹配）',
        gender: '官方',
      }))
    : GEMINI_VOICES;

  // 引擎切换后，当前声线若不属于该引擎目录则重置为目录首项
  useEffect(() => {
    const ids = voiceOptions.map(v => v.id);
    if (ids.length === 0) return;
    if (!ids.includes(selectedVoice)) setSelectedVoice(ids[0]);
    if (!ids.includes(speaker1Voice)) setSpeaker1Voice(ids[0]);
    if (!ids.includes(speaker2Voice)) setSpeaker2Voice(ids[1] || ids[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isQwenEngine, qwenVoices.length]);

  const [isGenerating, setIsGenerating] = useState(false);
  // 诚实失败（硬性约束 #2）：引擎失败时展示真实原因，不再生成三角波假旁白
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedAudio, setGeneratedAudio] = useState<{
    audioUrl: string;
    blob?: Blob;
    duration: number;
    sampleRate: number;
    title: string;
    text: string;
    voice: string;
  } | null>(null);

  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(folders[0]?.id || '');
  const [assetTitle, setAssetTitle] = useState('');

  const emotions = [
    { label: '沉稳专业', prompt: 'calm and professional news tone' },
    { label: '热情激昂', prompt: 'excited, enthusiastic and energetic commercial tone' },
    { label: '悬疑低语', prompt: 'mysterious, suspenseful whispered storytelling tone' },
    { label: '温暖亲切', prompt: 'warm, gentle and comforting bedtime story tone' },
    { label: '史诗震撼', prompt: 'epic, cinematic movie trailer narrator tone' },
  ];

  const templates = [
    {
      title: '科技发布会旁白',
      content: '突破想象的边界。下一代音频工作站现已降临，以前所未有的纯净音质，重塑每一个听觉瞬间。',
    },
    {
      title: '睡前疗愈伴读',
      content: '闭上眼睛，深呼吸。让轻柔的微风吹散一整天的疲惫，今晚，愿你在宁静中拥有一场好梦。',
    },
    {
      title: '科幻电影预告',
      content: '在星辰诞生之前，宇宙只是一片寂静。直到那一束光的降临，命运的齿轮开始轰鸣转动。',
    },
    {
      title: '短视频爆款开场',
      content: '停一下！千万别划走！今天教你用三个神仙技巧，轻松玩转AI音频创作，建议先赞后看！',
    },
  ];

  const handleGenerate = async () => {
    setIsGenerating(true);
    setSaveSuccess(false);
    setGenerationError(null);

    const promptText = mode === 'single' ? text : dialogueText;
    const defaultTitle = mode === 'single' 
      ? `AI语音-${selectedVoice}-${promptText.slice(0, 10)}...`
      : `AI双人对话-${promptText.slice(0, 10)}...`;

    try {
      const response = await fetch('/api/generate-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: promptText,
          voiceName: selectedVoice,
          emotion: selectedEmotion,
          speed: modelConfig.speed,
          temperature: modelConfig.temperature,
          systemInstruction: modelConfig.customSystemInstruction,
          ttsModel: modelConfig.ttsModel,
          multiSpeaker: mode === 'dialogue',
          speakers: [
            { speaker: modelConfig.dialogueSpeaker1?.name || '主持人', voiceName: speaker1Voice },
            { speaker: modelConfig.dialogueSpeaker2?.name || '嘉宾', voiceName: speaker2Voice },
          ],
        }),
      });

      const data = await response.json();

      // 诚实失败：任何"未生成音频"的服务器应答都如实展示原因，不再本地伪造（硬性约束 #2）
      if (!response.ok || data.error || data.fallbackRequired || !data.audioUrl) {
        setGenerationError(data.error || data.message || `语音生成失败（HTTP ${response.status}）。`);
        return;
      }

      // audioUrl 现为 /api/artifacts/:id（P4 起不再回传 data: Base64，硬性约束 #7）
      const res = await fetch(data.audioUrl);
      const blob = await res.blob();

      setGeneratedAudio({
        audioUrl: data.audioUrl,
        blob,
        duration: data.duration || 3.0,
        sampleRate: data.sampleRate || 24000,
        title: defaultTitle,
        text: promptText,
        voice: selectedVoice,
      });
      setAssetTitle(defaultTitle);
    } catch (err: any) {
      console.error('Speech generation request failed:', err);
      setGenerationError(`语音生成请求失败：${err?.message || '网络错误'}。请检查引擎服务是否已启动。`);
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePreviewPlay = () => {
    if (!generatedAudio) return;
    if (isPlayingPreview && audioElement) {
      audioElement.pause();
      setIsPlayingPreview(false);
    } else {
      const audio = new Audio(generatedAudio.audioUrl);
      audio.onended = () => setIsPlayingPreview(false);
      audio.play();
      setAudioElement(audio);
      setIsPlayingPreview(true);
    }
  };

  const handleSaveToLibrary = () => {
    if (!generatedAudio) return;

    const newItem: AudioItem = {
      id: `speech-${Date.now()}`,
      title: assetTitle || generatedAudio.title,
      description: generatedAudio.text,
      category: 'speech',
      duration: Math.round(generatedAudio.duration * 10) / 10,
      sampleRate: generatedAudio.sampleRate,
      channels: 1,
      format: 'wav',
      fileSize: generatedAudio.blob?.size || 48000,
      createdAt: new Date().toISOString(),
      tags: ['语音合成', generatedAudio.voice, selectedEmotion, mode === 'dialogue' ? '双人对话' : '单人旁白'],
      rating: 5,
      folderId: selectedFolderId || undefined,
      transcript: generatedAudio.text,
      audioUrl: generatedAudio.audioUrl,
      waveformData: [0.3, 0.6, 0.8, 0.5, 0.9, 0.7, 0.8, 0.4, 0.6, 0.9, 0.5, 0.7],
      metadata: {
        voiceName: generatedAudio.voice,
        emotion: selectedEmotion,
        isAiGenerated: true,
        source: 'tts',
      },
    };

    onSaveToLibrary(newItem, generatedAudio.blob);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="flex-1 bg-neutral-950 p-6 overflow-y-auto pb-32">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-neutral-800 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-neutral-100">AI 智能语音合成工作台 (TTS)</h2>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              基于 Google Gemini 语音大模型，提供超自然多角色情感配音与多角色播客对话合成
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Quick Voice Model Config Trigger */}
            {onOpenVoiceModelConfig && (
              <button
                onClick={onOpenVoiceModelConfig}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold shadow-sm transition-all active:scale-95"
                title="打开语音大模型配置中心"
              >
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>配置语音大模型</span>
              </button>
            )}

            {/* Mode Switcher */}
            <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-xl p-1 text-xs">
              <button
                onClick={() => setMode('single')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                  mode === 'single' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>单人旁白</span>
              </button>
              <button
                onClick={() => setMode('dialogue')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                  mode === 'dialogue' ? 'bg-indigo-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>双人播客对谈</span>
              </button>
            </div>
          </div>
        </div>

        {/* Voice LLM Active Parameter Status Ribbon */}
        <div 
          onClick={onOpenVoiceModelConfig}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-neutral-900/80 border border-neutral-800/80 hover:border-cyan-500/40 rounded-xl text-xs transition-colors cursor-pointer group"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-neutral-300">
              <Cpu className="w-3.5 h-3.5 text-cyan-400 group-hover:animate-pulse" />
              <span className="text-neutral-400">语音大模型:</span>
              <span className="font-mono font-bold text-cyan-300">{modelConfig.ttsModel}</span>
            </div>

            <span className="text-neutral-700 hidden sm:inline">•</span>

            <div className="flex items-center gap-1 text-neutral-300">
              <span className="text-neutral-400">语速:</span>
              <span className="font-mono text-neutral-200">{modelConfig.speed.toFixed(2)}x</span>
            </div>

            <span className="text-neutral-700 hidden sm:inline">•</span>

            <div className="flex items-center gap-1 text-neutral-300">
              <span className="text-neutral-400">感染力:</span>
              <span className="font-mono text-neutral-200">{modelConfig.temperature.toFixed(2)}</span>
            </div>

            <span className="text-neutral-700 hidden sm:inline">•</span>

            <div className="flex items-center gap-1 text-neutral-300">
              <span className="text-neutral-400">声学封装:</span>
              <span className="font-mono text-emerald-400">24kHz WAV</span>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-cyan-400 group-hover:text-cyan-300 font-medium">
            <span>调节大模型参数</span>
            <Sliders className="w-3 h-3 ml-0.5" />
          </div>
        </div>

        {/* Voice Selection Cards */}
        {mode === 'single' ? (
          <div>
            <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider block mb-2">
              选择AI声线 (Voice Model)
              <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-cyan-300">
                {isQwenEngine ? 'Qwen 官方目录' : 'Google Voice'}
              </span>
            </label>
            {isQwenEngine && voiceOptions.length === 0 && (
              <p className="text-xs text-amber-300/90 bg-amber-950/20 border border-amber-500/30 rounded-lg px-3 py-2 mb-2">
                Worker 未启动或音色目录未加载：请先双击 worker/「启动Worker.command」，刷新页面后自动加载官方音色。
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {voiceOptions.map((v) => {
                const isSelected = selectedVoice === v.id;
                return (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVoice(v.id)}
                    className={`cursor-pointer rounded-xl p-3 border transition-all ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500/80 shadow-lg shadow-indigo-950/50 ring-1 ring-indigo-500/50'
                        : 'bg-neutral-900/60 border-neutral-800 hover:bg-neutral-900 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-sm text-neutral-100">{v.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-indigo-300 font-medium">
                        {v.tag}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed">
                      {v.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4">
              <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider block mb-2">
                角色 1 (主持人) 声线
              </span>
              <select
                value={speaker1Voice}
                onChange={(e) => setSpeaker1Voice(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500"
              >
                {voiceOptions.map(v => (
                  <option key={v.id} value={v.id}>{v.name} ({v.tag} - {v.gender})</option>
                ))}
              </select>
            </div>

            <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4">
              <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider block mb-2">
                角色 2 (嘉宾) 声线
              </span>
              <select
                value={speaker2Voice}
                onChange={(e) => setSpeaker2Voice(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500"
              >
                {voiceOptions.map(v => (
                  <option key={v.id} value={v.id}>{v.name} ({v.tag} - {v.gender})</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Emotion & Tone Selector */}
        <div>
          <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider block mb-2">
            情感张力与语调 (Emotion & Tone)
          </label>
          <div className="flex flex-wrap gap-2">
            {emotions.map((emo) => (
              <button
                key={emo.label}
                onClick={() => setSelectedEmotion(emo.label)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedEmotion === emo.label
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
                }`}
              >
                {emo.label}
              </button>
            ))}
          </div>
        </div>

        {/* Text Input Area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              {mode === 'single' ? '配音文本内容' : '对话剧本（格式：角色名: 台词）'}
            </label>
            <span className="text-xs font-mono text-neutral-500">
              {(mode === 'single' ? text : dialogueText).length} 字符
            </span>
          </div>

          <textarea
            rows={5}
            value={mode === 'single' ? text : dialogueText}
            onChange={(e) => mode === 'single' ? setText(e.target.value) : setDialogueText(e.target.value)}
            placeholder={mode === 'single' ? '输入需要转换为语音的文字内容...' : '主持人: 欢迎来到节目...\n嘉宾: 谢谢主持人...'}
            className="w-full bg-neutral-900/90 border border-neutral-800 rounded-xl p-3.5 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 leading-relaxed transition-all"
          />

          {/* Prompt Templates */}
          <div className="flex items-center gap-2 pt-1 overflow-x-auto">
            <span className="text-[11px] text-neutral-500 shrink-0">灵感模板:</span>
            {templates.map((tpl) => (
              <button
                key={tpl.title}
                onClick={() => {
                  if (mode === 'single') {
                    setText(tpl.content);
                  }
                }}
                className="shrink-0 px-2.5 py-1 rounded bg-neutral-900 border border-neutral-800 text-[11px] text-neutral-400 hover:text-indigo-300 hover:border-neutral-700 transition-colors"
              >
                {tpl.title}
              </button>
            ))}
          </div>
        </div>

        {/* Generate Action Button */}
        <div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !(mode === 'single' ? text.trim() : dialogueText.trim())}
            className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white shadow-lg shadow-indigo-950/60 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all active:scale-[0.99]"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
                <span>AI 正在合成高保真语音...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-cyan-200" />
                <span>立即生成高保真音频</span>
              </>
            )}
          </button>
        </div>

        {/* Honest Failure Card：展示真实失败原因，不伪造音频（硬性约束 #1/#2） */}
        {generationError && (
          <div className="bg-rose-950/30 border border-rose-500/40 rounded-2xl p-4 space-y-2 animate-fadeIn">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="space-y-1 min-w-0">
                <h4 className="text-sm font-bold text-rose-200">语音生成失败</h4>
                <p className="text-xs text-rose-200/80 leading-relaxed break-words">{generationError}</p>
                <p className="text-[11px] text-neutral-400">
                  提示：云端引擎需在配置中填写 Gemini API key；本地引擎需先启动 Qwen3-TTS「启动网页版.command」。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Generated Result Card */}
        {generatedAudio && (
          <div className="bg-neutral-900/80 border border-indigo-500/40 rounded-2xl p-5 space-y-4 shadow-xl shadow-indigo-950/30 animate-fadeIn">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                  <Volume2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-neutral-100">语音合成成功</h4>
                  <span className="text-xs text-neutral-400 font-mono">
                    时长约 {Math.round(generatedAudio.duration * 10) / 10} 秒 • 采样率 {generatedAudio.sampleRate} Hz
                  </span>
                </div>
              </div>

              {/* Playback preview */}
              <button
                onClick={togglePreviewPlay}
                className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  isPlayingPreview
                    ? 'bg-rose-500 text-white'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                }`}
              >
                {isPlayingPreview ? (
                  <>
                    <Pause className="w-4 h-4 fill-current" />
                    <span>暂停试听</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>试听播放</span>
                  </>
                )}
              </button>
            </div>

            {/* Asset Metadata Form for Saving */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                  素材名称
                </label>
                <input
                  type="text"
                  value={assetTitle}
                  onChange={(e) => setAssetTitle(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                  归档文件夹
                </label>
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">未归类</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <a
                  href={generatedAudio.audioUrl}
                  download={`${assetTitle || 'ai-speech'}.wav`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载 WAV</span>
                </a>

                <button
                  onClick={() => {
                    const tempItem: AudioItem = {
                      id: `temp-${Date.now()}`,
                      title: assetTitle || generatedAudio.title,
                      category: 'speech',
                      duration: generatedAudio.duration,
                      sampleRate: generatedAudio.sampleRate,
                      channels: 1,
                      format: 'wav',
                      fileSize: 48000,
                      createdAt: new Date().toISOString(),
                      tags: ['语音'],
                      rating: 5,
                      audioUrl: generatedAudio.audioUrl,
                    };
                    onOpenEditor(tempItem);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>在调音台剪辑</span>
                </button>
              </div>

              <button
                onClick={handleSaveToLibrary}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-950/40 transition-all active:scale-95"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    <span>已存入素材库！</span>
                  </>
                ) : (
                  <>
                    <FolderPlus className="w-4 h-4" />
                    <span>保存至素材库</span>
                  </>
                )}
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
