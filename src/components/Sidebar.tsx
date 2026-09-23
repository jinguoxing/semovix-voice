import React, { useState } from 'react';
import { 
  Folder, 
  FolderPlus, 
  Layers, 
  Mic, 
  Sparkles, 
  Music, 
  Radio, 
  FileAudio, 
  Star, 
  Tag, 
  Trash2, 
  ChevronRight,
  Database,
  Filter
} from 'lucide-react';
import { AudioCategory, AudioFolder } from '../types/audio';

interface SidebarProps {
  selectedCategory: string; // 'all' | AudioCategory
  onSelectCategory: (cat: string) => void;
  selectedFolderId?: string;
  onSelectFolder: (folderId?: string) => void;
  folders: AudioFolder[];
  onCreateFolder: (name: string, color?: string) => void;
  onDeleteFolder: (id: string) => void;
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  allTags: { tag: string; count: number }[];
  onlyFavorites: boolean;
  onToggleOnlyFavorites: () => void;
  categoryCounts: Record<string, number>;
  totalCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedCategory,
  onSelectCategory,
  selectedFolderId,
  onSelectFolder,
  folders,
  onCreateFolder,
  onDeleteFolder,
  selectedTags,
  onToggleTag,
  allTags,
  onlyFavorites,
  onToggleOnlyFavorites,
  categoryCounts,
  totalCount,
}) => {
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#38bdf8');

  const categories = [
    { id: 'all', label: '全部素材', icon: Layers, color: 'text-neutral-400' },
    { id: 'speech', label: 'AI 语音合成', icon: Radio, color: 'text-indigo-400' },
    { id: 'sfx', label: '智能音效 (SFX)', icon: Sparkles, color: 'text-fuchsia-400' },
    { id: 'music', label: '音乐与伴奏', icon: Music, color: 'text-emerald-400' },
    { id: 'recording', label: '现场录音', icon: Mic, color: 'text-rose-400' },
    { id: 'sample', label: '音频采样', icon: FileAudio, color: 'text-cyan-400' },
  ];

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    onCreateFolder(newFolderName.trim(), newFolderColor);
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  return (
    <aside className="w-64 shrink-0 bg-neutral-900/60 border-r border-neutral-800 p-4 flex flex-col gap-6 overflow-y-auto h-[calc(100vh-4rem)]">
      
      {/* 1. Category Navigation */}
      <div>
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-2">
          <span>素材分类</span>
          <span className="text-[10px] text-neutral-400 font-mono">{totalCount} 项</span>
        </div>
        <div className="space-y-1">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const count = cat.id === 'all' ? totalCount : categoryCounts[cat.id] || 0;
            const isActive = selectedCategory === cat.id && !selectedFolderId;

            return (
              <button
                key={cat.id}
                onClick={() => {
                  onSelectCategory(cat.id);
                  onSelectFolder(undefined);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-semibold'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${cat.color}`} />
                  <span>{cat.label}</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                  isActive ? 'bg-cyan-500/20 text-cyan-200' : 'bg-neutral-800 text-neutral-500'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Folders / Collections */}
      <div>
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-2">
          <div className="flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 text-neutral-400" />
            <span>素材文件夹</span>
          </div>
          <button
            onClick={() => setIsCreatingFolder(!isCreatingFolder)}
            className="text-neutral-400 hover:text-cyan-400 transition-colors p-0.5 rounded"
            title="新建素材文件夹"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>

        {isCreatingFolder && (
          <form onSubmit={handleCreateFolder} className="p-2 mb-2 bg-neutral-950/80 rounded-lg border border-neutral-700/80 space-y-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="文件夹名称..."
              autoFocus
              className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-cyan-500"
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {['#38bdf8', '#a855f7', '#34d399', '#fbbf24', '#f43f5e'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewFolderColor(c)}
                    className={`w-3.5 h-3.5 rounded-full transition-transform ${newFolderColor === c ? 'scale-125 ring-2 ring-white/60' : 'opacity-70'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsCreatingFolder(false)}
                  className="px-2 py-0.5 text-[10px] text-neutral-400 hover:text-neutral-200"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-2 py-0.5 text-[10px] bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium"
                >
                  创建
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="space-y-1">
          {folders.map((folder) => {
            const isSelected = selectedFolderId === folder.id;
            return (
              <div
                key={folder.id}
                className={`group flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-neutral-800 text-neutral-100 border border-neutral-700 shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40'
                }`}
                onClick={() => {
                  onSelectFolder(isSelected ? undefined : folder.id);
                  onSelectCategory('all');
                }}
              >
                <div className="flex items-center gap-2 truncate">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: folder.color || '#6366f1' }}
                  />
                  <span className="truncate">{folder.name}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`确定要删除文件夹 "${folder.name}" 吗？（不会删除素材本身）`)) {
                      onDeleteFolder(folder.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 transition-opacity"
                  title="删除文件夹"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Quick Filters & Stars */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-2 flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-neutral-400" />
          <span>快速筛选</span>
        </div>
        <button
          onClick={onToggleOnlyFavorites}
          className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            onlyFavorites
              ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40'
          }`}
        >
          <div className="flex items-center gap-2">
            <Star className={`w-3.5 h-3.5 ${onlyFavorites ? 'text-amber-400 fill-amber-400' : 'text-neutral-500'}`} />
            <span>精选高分 (★ 4-5星)</span>
          </div>
        </button>
      </div>

      {/* 4. Tag Cloud */}
      <div className="flex-1">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-2">
          <div className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-neutral-400" />
            <span>标签索引</span>
          </div>
          {selectedTags.length > 0 && (
            <button
              onClick={() => selectedTags.forEach(t => onToggleTag(t))}
              className="text-[10px] text-cyan-400 hover:underline"
            >
              清空筛选
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 px-1">
          {allTags.slice(0, 18).map(({ tag, count }) => {
            const isTagActive = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => onToggleTag(tag)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
                  isTagActive
                    ? 'bg-cyan-500 text-neutral-950 font-semibold shadow-sm shadow-cyan-500/20'
                    : 'bg-neutral-800/80 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-750 border border-neutral-700/60'
                }`}
              >
                <span>{tag}</span>
                <span className={`text-[9px] opacity-70`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* System Status Footnote */}
      <div className="pt-3 border-t border-neutral-800 text-[11px] text-neutral-400 space-y-1">
        <div className="flex items-center gap-1.5 text-neutral-400">
          <Database className="w-3.5 h-3.5 text-emerald-400" />
          <span>本地高速 IndexedDB 存储</span>
        </div>
        <p className="text-[10px]">所有音频资产本地即时处理，免云端延迟</p>
      </div>

    </aside>
  );
};
