import { VoiceModelConfig } from '../types/audio';

export type { VoiceModelConfig };

export const DEFAULT_VOICE_MODEL_CONFIG: VoiceModelConfig = {
  ttsModel: 'gemini-3.1-flash-tts-preview',
  transcribeModel: 'gemini-3.5-transcribe',
  reasoningModel: 'gemini-3.8-flash',
  defaultVoice: 'Kore',
  defaultEmotion: '沉稳专业',
  speed: 1.0,
  temperature: 0.7,
  sampleRate: 24000,
  audioContainer: 'wav',
  customSystemInstruction: '发音自然地道，咬字清晰，根据指定的情感基调呈现生动自然的语调起伏，标点符号处保留逼真的呼吸停顿。',
  languageHint: 'zh-CN',
  dialogueSpeaker1: {
    name: '主持人',
    voice: 'Kore',
  },
  dialogueSpeaker2: {
    name: '嘉宾',
    voice: 'Puck',
  },
  pacing: 'natural',
};

const STORAGE_KEY = 'audiocraft_voice_llm_config';

export function getVoiceModelConfig(): VoiceModelConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_MODEL_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_VOICE_MODEL_CONFIG, ...parsed };
  } catch (e) {
    console.warn('Failed to parse voice model config from localStorage', e);
    return DEFAULT_VOICE_MODEL_CONFIG;
  }
}

export function saveVoiceModelConfig(config: VoiceModelConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    // Dispatch custom event for reactive updates across components
    window.dispatchEvent(new CustomEvent('voice-model-config-updated', { detail: config }));
  } catch (e) {
    console.error('Failed to save voice model config', e);
  }
}

export function resetVoiceModelConfig(): VoiceModelConfig {
  saveVoiceModelConfig(DEFAULT_VOICE_MODEL_CONFIG);
  return DEFAULT_VOICE_MODEL_CONFIG;
}

export interface ModelOptionInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  tag: string;
  badgeClass: string;
  isRecommended?: boolean;
  capabilities: string[];
}

export const AVAILABLE_TTS_MODELS: ModelOptionInfo[] = [
  {
    id: 'gemini-3.1-flash-tts-preview',
    name: 'Gemini 3.1 Flash TTS',
    provider: 'Google DeepMind',
    description: '官方推荐：超低延迟、高拟真度原生多模态语音合成大模型，支持单人多情绪与双人多角色对话。',
    tag: '官方主力推荐',
    badgeClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    isRecommended: true,
    capabilities: ['原生 24kHz 高采样率', '双人交替对谈', '情绪细粒度注入', '毫秒级响应'],
  },
  {
    id: 'gemini-3.8-live',
    name: 'Gemini 3.8 Live Audio',
    provider: 'Google DeepMind',
    description: '实时对话级全双工声学模型，具备更强的口语化断句、呼吸停顿与实时互动拟真感。',
    tag: '次世代实时声学',
    badgeClass: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    capabilities: ['全双工自然交互', '逼真口语停顿', '微情绪流式表达'],
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Audio Modality)',
    provider: 'Google DeepMind',
    description: '新一代多模态旗舰音频架构，结合极高推理速度与更深层次的剧本文意理解力。',
    tag: '高智商语义增强',
    badgeClass: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    capabilities: ['长剧本全局声学一致性', '文生声精确控制', '极速处理能力'],
  },
  {
    id: 'web-speech-native',
    name: 'Web Audio / Local Browser Speech Engine',
    provider: 'Client-Side Offline',
    description: '本地离线备用合成器：无需 API 密钥与外部网络，直接调用终端系统原生合成与声学 DSP 发生器。',
    tag: '离线零延迟兜底',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    capabilities: ['100% 离线可用', '零网络消耗', '系统级发音人支持'],
  },
];

export const AVAILABLE_TRANSCRIBE_MODELS: ModelOptionInfo[] = [
  {
    id: 'gemini-3.5-transcribe',
    name: 'Gemini 3.5 Transcribe',
    provider: 'Google DeepMind',
    description: '专为高精度音视频听翻设计的转写大模型，具备抗噪、口音容错与长音频结构化理解能力。',
    tag: '高精听写首选',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    isRecommended: true,
    capabilities: ['中英文混合转写', '多说话人自动区分', '情绪与语调标签提取'],
  },
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash Multimodal',
    provider: 'Google DeepMind',
    description: '通用多模态超快推理模型，同步输出逐字稿、情绪摘要与素材多维标签推荐。',
    tag: '多维度声学分析',
    badgeClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    capabilities: ['深度内容摘要生成', '智能标签推荐', '背景声景分析'],
  },
  {
    id: 'gemini-3.5-transcribe-live',
    name: 'Gemini 3.5 Transcribe Live',
    provider: 'Google DeepMind',
    description: '流式近实时转录模型，适配正在录音时的边录边翻与实时字幕生成。',
    tag: '低延迟流式',
    badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    capabilities: ['流式瞬时输出', '低缓冲时延', '时间戳对齐'],
  },
];

export const AVAILABLE_REASONING_MODELS: ModelOptionInfo[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    provider: 'Google DeepMind',
    description: '轻量极速架构，专精于音效程序化物理振荡器参数、合成器滤波包络及 16 步进鼓机律动编曲。',
    tag: '高吞吐极速推理',
    badgeClass: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    isRecommended: true,
    capabilities: ['DSP 算法物理建模', '电子乐和弦级进分析', '瞬时 JSON 结构化输出'],
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro (Complex Reasoning)',
    provider: 'Google DeepMind',
    description: '高阶推理架构，具备更加复杂的音乐理论声学构想、非线性母带链设计与深度剧本理解力。',
    tag: '高阶复杂音乐理论',
    badgeClass: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    capabilities: ['高级复调编排', '声场物理声学模拟', '专业母带动态规划'],
  },
];

export interface VoicePersonaInfo {
  id: string;
  name: string;
  gender: '男声' | '女声';
  title: string;
  tag: string;
  desc: string;
  bestFor: string;
  previewPrompt: string;
  badgeColor: string;
}

export const AVAILABLE_VOICES: VoicePersonaInfo[] = [
  {
    id: 'Kore',
    name: 'Kore',
    gender: '男声',
    title: '权威男中音',
    tag: '沉稳睿智',
    desc: '音质纯厚均衡，充满说服力与稳重感，发音严谨标准。',
    bestFor: '商业发布、科技产品介绍、新闻纪录片、知识付费讲座',
    previewPrompt: '探索未知是人类前进的动力。无论前路多么遥远，智慧的火花终将照亮前行的方向。',
    badgeColor: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10',
  },
  {
    id: 'Puck',
    name: 'Puck',
    gender: '男声',
    title: '朝气男高音',
    tag: '活力轻快',
    desc: '明亮通透的高频声线，富有年轻张力与感染力。',
    bestFor: '播客对谈、短视频解说、游戏互动、快节奏广告营销',
    previewPrompt: '哈喽大家好！今天我们要聊一个超级酷炫的话题，赶紧带上耳机，一起出发吧！',
    badgeColor: 'border-amber-500/30 text-amber-400 bg-amber-500/10',
  },
  {
    id: 'Fenrir',
    name: 'Fenrir',
    gender: '男声',
    title: '电影级重低音',
    tag: '磁性厚重',
    desc: '极具共鸣腔体的低频声线，自带沉浸式史诗氛围。',
    bestFor: '电影预告片、科幻小说旁白、沉浸式剧场、悬疑叙事',
    previewPrompt: '黑夜降临，星河静止。在这个被遗忘的纪元，属于英雄的传说正悄然苏醒。',
    badgeColor: 'border-purple-500/30 text-purple-400 bg-purple-500/10',
  },
  {
    id: 'Charon',
    name: 'Charon',
    gender: '男声',
    title: '播音级标准音',
    tag: '专业播报',
    desc: '声场开阔、字正腔圆，客观理性且富有条理。',
    bestFor: '行业深度研报、企业培训、政经新闻、智能硬件助手',
    previewPrompt: '截至今日收盘，全球科技指数实现稳健增长，高新技术产业链创新动能持续增强。',
    badgeColor: 'border-blue-500/30 text-blue-400 bg-blue-500/10',
  },
  {
    id: 'Zephyr',
    name: 'Zephyr',
    gender: '女声',
    title: '知性疗愈女声',
    tag: '温暖知性',
    desc: '声线轻柔细腻，富有共情力与治愈感，语速舒缓柔和。',
    bestFor: '有声书伴读、睡前冥想、心理疗愈、情感电台、儿童文学',
    previewPrompt: '放松身心，让所有的喧嚣与疲惫随风飘散。今夜，请在温暖的微光中安然入眠。',
    badgeColor: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
  },
];
