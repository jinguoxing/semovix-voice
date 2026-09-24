import React from 'react';
import {
  Archive,
  FolderGit2,
  Layers,
  Mic,
  Music,
  Radio,
  Search,
  Sliders,
  Sparkles,
  Upload,
} from 'lucide-react';

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

const navigation = [
  { id: 'library', label: '素材库', icon: FolderGit2 },
  { id: 'tts', label: 'AI 语音合成', icon: Radio },
  { id: 'sfx', label: '智能音效', icon: Sparkles },
  { id: 'beat', label: '节奏工坊', icon: Music },
  { id: 'multitrack', label: '多轨混音台', icon: Layers },
] as const;

const SearchField: React.FC<Pick<NavbarProps, 'searchQuery' | 'onSearchChange'>> = ({
  searchQuery,
  onSearchChange,
}) => (
  <div className="relative w-full">
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    <input
      type="search"
      aria-label="搜索音频、标签或转录"
      value={searchQuery}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder="搜索音频、标签或转录..."
      className="h-10 w-full rounded-lg border border-slate-700/80 bg-slate-950/70 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 transition-colors focus:border-sky-400/70 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
    />
  </div>
);

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
      return `${hrs}小时${mins % 60}分`;
    }
    return `${mins}分${secs}秒`;
  };

  const actions = [
    { label: '工程备份', title: '工程归档与数据备份 (ZIP)', icon: Archive, onClick: onOpenProjectBackup },
    { label: '大模型配置', title: '配置语音大模型参数与音色画像', icon: Sliders, onClick: onOpenVoiceModelConfig },
    { label: '录音', title: '启动录音室录制麦克风', icon: Mic, onClick: onOpenRecorder },
    { label: '导入', title: '导入本地音频文件', icon: Upload, onClick: onOpenImporter },
  ] as const;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0d1628]/95 shadow-[0_8px_24px_rgba(2,8,23,0.18)] backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-[72px] items-center justify-between gap-3 py-2.5 sm:gap-5">
          <div className="flex shrink-0 items-center gap-3">
            <div className="overflow-hidden rounded-lg bg-white shadow-[0_3px_12px_rgba(2,8,23,0.22)]">
              <img src="/voice-logo.png" alt="Voice" className="block h-11 w-auto sm:h-12" />
            </div>
            <div className="hidden border-l border-slate-700 pl-3 sm:block">
              <span className="block text-xs font-semibold tracking-wide text-slate-100">音频工作台</span>
              <span className="block text-[11px] text-slate-400">创作 · 管理 · 混音</span>
            </div>
          </div>

          <div className="hidden min-w-0 max-w-sm flex-1 md:block">
            <SearchField searchQuery={searchQuery} onSearchChange={onSearchChange} />
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5" aria-label="快捷操作">
            {actions.map(({ label, title, icon: Icon, onClick }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                title={title}
                aria-label={label}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-700/80 bg-slate-800/60 px-2.5 text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700/70 hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 sm:px-3"
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="hidden whitespace-nowrap text-xs font-medium xl:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="pb-2 md:hidden">
          <SearchField searchQuery={searchQuery} onSearchChange={onSearchChange} />
        </div>

        <div className="flex items-end justify-between gap-4">
          <nav aria-label="工作台导航" className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex min-w-max items-center gap-1">
              {navigation.map(({ id, label, icon: Icon }) => {
                const active = currentTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onTabChange(id)}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 sm:px-4',
                      active
                        ? 'border-sky-400 bg-sky-400/10 text-white'
                        : 'border-transparent text-slate-400 hover:border-slate-600 hover:bg-white/5 hover:text-slate-100',
                    ].join(' ')}
                  >
                    <Icon aria-hidden="true" className={'h-4 w-4 ' + (active ? 'text-sky-300' : 'text-slate-500')} />
                    <span>{label}</span>
                    {id === 'library' && (
                      <span className={'rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ' + (active ? 'bg-sky-300/15 text-sky-200' : 'bg-slate-800 text-slate-400')}>
                        {totalItems}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
          <div className="hidden shrink-0 pb-3 text-right lg:block">
            <span className="mr-2 text-[11px] text-slate-500">素材总时长</span>
            <span className="font-mono text-xs tabular-nums text-slate-300">{formatTotalTime(totalDurationSeconds)}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
