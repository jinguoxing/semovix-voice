import React from 'react';
import { 
  Waves, 
  FolderGit2, 
  Mic, 
  Sparkles, 
  Music, 
  Upload, 
  Radio, 
  Search,
  Sliders,
  AudioWaveform,
  Layers,
  Archive
} from 'lucide-react';
import { AudioCategory } from '../types/audio';

export type StudioTab = 'library' | 'tts' | 'sfx' | 'beat' | 'multitrack';

interface NavbarProps {
  currentTab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenRecorder: () => void;
  onOpenImporter: () => void;
  onOpenVoiceModelConfig: () => void;
  onOpenProjectBackup: () => void;
  totalItems: number;
  totalDurationSeconds: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  onOpenRecorder,
  onOpenImporter,
  onOpenVoiceModelConfig,
  onOpenProjectBackup,
  totalItems,
  totalDurationSeconds,
}) => {
  const formatTotalTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remainMins = mins % 60;
      return `${hrs}小时${remainMins}分`;
    }
    return `${mins}分${secs}秒`;
  };

  return (
    <header className="sticky top-0 z-40 bg-neutral-900/90 backdrop-blur-md border-b border-neutral-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        
        {/* Brand Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-indigo-600 to-fuchsia-600 p-[1px] shadow-lg shadow-cyan-950/40">
            <div className="w-full h-full bg-neutral-950 rounded-xl flex items-center justify-center">
              <AudioWaveform className="w-5 h-5 text-cyan-400 animate-pulse" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-neutral-100 via-cyan-200 to-indigo-300 bg-clip-text text-transparent">
                AudioCraft
              </span>
              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Studio
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 hidden sm:block">音频管理与智能生成工作站</p>
          </div>
        </div>

        {/* Studio View Navigation Tabs */}
        <nav className="flex items-center bg-neutral-950/80 p-1 rounded-xl border border-neutral-800/80">
          <button
            onClick={() => onTabChange('library')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'library'
                ? 'bg-neutral-800 text-white shadow-sm shadow-black/40 border border-neutral-700/60'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>素材库</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-neutral-900 text-neutral-400 font-mono">
              {totalItems}
            </span>
          </button>

          <button
            onClick={() => onTabChange('tts')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'tts'
                ? 'bg-neutral-800 text-white shadow-sm shadow-black/40 border border-neutral-700/60'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI 语音合成</span>
          </button>

          <button
            onClick={() => onTabChange('sfx')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'sfx'
                ? 'bg-neutral-800 text-white shadow-sm shadow-black/40 border border-neutral-700/60'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
            <span>智能音效 (SFX)</span>
          </button>

          <button
            onClick={() => onTabChange('beat')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'beat'
                ? 'bg-neutral-800 text-white shadow-sm shadow-black/40 border border-neutral-700/60'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60'
            }`}
          >
            <Music className="w-3.5 h-3.5 text-emerald-400" />
            <span>节奏工坊</span>
          </button>

          <button
            onClick={() => onTabChange('multitrack')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'multitrack'
                ? 'bg-neutral-800 text-white shadow-sm shadow-black/40 border border-neutral-700/60'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>多轨混音台</span>
            <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold">
              DAW
            </span>
          </button>
        </nav>

        {/* Global Search */}
        <div className="relative flex-1 max-w-xs hidden md:block">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索音频、标签或转录..."
            className="w-full bg-neutral-950/80 border border-neutral-800/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
          />
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Project Backup & Export */}
          <button
            onClick={onOpenProjectBackup}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 active:scale-95 transition-all shadow-sm"
            title="工程归档与数据备份 (ZIP)"
          >
            <Archive className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">工程备份</span>
          </button>

          {/* Voice Model Config Button */}
          <button
            onClick={onOpenVoiceModelConfig}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 active:scale-95 transition-all shadow-sm"
            title="配置语音大模型参数与音色画像"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">大模型配置</span>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse hidden md:inline" />
          </button>

          {/* Quick Record Button */}
          <button
            onClick={onOpenRecorder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 active:scale-95 transition-all"
            title="启动录音室录制麦克风"
          >
            <Mic className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
            <span className="hidden sm:inline">录音</span>
          </button>

          {/* Quick Upload Button */}
          <button
            onClick={onOpenImporter}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-200 border border-neutral-700/80 hover:bg-neutral-700/80 active:scale-95 transition-all"
            title="导入本地音频文件"
          >
            <Upload className="w-3.5 h-3.5 text-neutral-400" />
            <span className="hidden sm:inline">导入</span>
          </button>

          {/* Library Total Duration Indicator */}
          <div className="hidden lg:flex flex-col text-right pl-2 border-l border-neutral-800">
            <span className="text-[10px] text-neutral-400 uppercase tracking-wider">总时长</span>
            <span className="text-xs font-mono font-medium text-cyan-300">
              {formatTotalTime(totalDurationSeconds)}
            </span>
          </div>
        </div>

      </div>
    </header>
  );
};
