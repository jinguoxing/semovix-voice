import React, { useState } from 'react';
import { 
  Play, 
  Pause, 
  Scissors, 
  FileText, 
  Download, 
  Trash2, 
  FolderInput, 
  Sparkles, 
  Star, 
  Tag as TagIcon,
  LayoutGrid, 
  List, 
  ArrowUpDown, 
  CheckSquare, 
  Square, 
  MoreVertical,
  Radio,
  Music,
  Mic,
  FileAudio,
  Clock,
  HardDrive
} from 'lucide-react';
import { AudioItem, AudioFolder } from '../types/audio';

interface AudioLibraryViewProps {
  items: AudioItem[];
  folders: AudioFolder[];
  currentlyPlayingId: string | null;
  isPlaying: boolean;
  onPlayPause: (item: AudioItem) => void;
  onOpenEditor: (item: AudioItem) => void;
  onOpenTranscribe: (item: AudioItem) => void;
  onAutoTag: (item: AudioItem) => void;
  onDelete: (id: string) => void;
  onBatchDelete: (ids: string[]) => void;
  onBatchMoveFolder: (ids: string[], folderId?: string) => void;
  onBatchAddTags: (ids: string[], tags: string[]) => void;
  onUpdateRating: (id: string, rating: number) => void;
  onDownload: (item: AudioItem) => void;
  onOpenSubtitleExport?: (item: AudioItem) => void;
}

export const AudioLibraryView: React.FC<AudioLibraryViewProps> = ({
  items,
  folders,
  currentlyPlayingId,
  isPlaying,
  onPlayPause,
  onOpenEditor,
  onOpenTranscribe,
  onAutoTag,
  onDelete,
  onBatchDelete,
  onBatchMoveFolder,
  onBatchAddTags,
  onUpdateRating,
  onDownload,
  onOpenSubtitleExport,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'duration-desc' | 'title' | 'rating'>('date-desc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showMoveFolderModal, setShowMoveFolderModal] = useState(false);
  const [showBatchTagModal, setShowBatchTagModal] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');

  // Sorting
  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'date-desc') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (sortBy === 'date-asc') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (sortBy === 'duration-desc') return b.duration - a.duration;
    if (sortBy === 'title') return a.title.localeCompare(b.title);
    if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
    return 0;
  });

  // Batch selection handlers
  const handleSelectAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map(i => i.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}.${ms}`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getCategoryMeta = (cat: string) => {
    switch (cat) {
      case 'speech':
        return { label: '语音合成', icon: Radio, badgeClass: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' };
      case 'sfx':
        return { label: '智能音效', icon: Sparkles, badgeClass: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20' };
      case 'music':
        return { label: '音乐旋律', icon: Music, badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
      case 'recording':
        return { label: '现场录音', icon: Mic, badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
      default:
        return { label: '采样素材', icon: FileAudio, badgeClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' };
    }
  };

  return (
    <div className="player-aware-scroll flex-1 flex flex-col min-w-0 bg-neutral-950 p-6 overflow-y-auto">
      
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-neutral-800">
        
        {/* Left: Stats & Batch Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 border border-neutral-800 text-neutral-300 hover:bg-neutral-800 transition-colors"
          >
            {selectedIds.length === items.length && items.length > 0 ? (
              <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <Square className="w-3.5 h-3.5 text-neutral-500" />
            )}
            <span>{selectedIds.length > 0 ? `已选 (${selectedIds.length})` : '全选'}</span>
          </button>

          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1.5 animate-fadeIn">
              <button
                onClick={() => setShowMoveFolderModal(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 border border-neutral-700 text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                <FolderInput className="w-3.5 h-3.5 text-cyan-400" />
                <span>移动至文件夹</span>
              </button>

              <button
                onClick={() => setShowBatchTagModal(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-neutral-900 border border-neutral-700 text-neutral-200 hover:bg-neutral-800 transition-colors"
              >
                <TagIcon className="w-3.5 h-3.5 text-indigo-400" />
                <span>批量打标</span>
              </button>

              <button
                onClick={() => {
                  if (confirm(`确定要删除选中的 ${selectedIds.length} 个音频文件吗？`)) {
                    onBatchDelete(selectedIds);
                    setSelectedIds([]);
                  }
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>批量删除</span>
              </button>
            </div>
          )}
        </div>

        {/* Right: Sort & View Toggle */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 text-neutral-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-neutral-300 font-medium focus:outline-none cursor-pointer"
            >
              <option value="date-desc">创建时间 (最新)</option>
              <option value="date-asc">创建时间 (最早)</option>
              <option value="duration-desc">时长 (最长)</option>
              <option value="rating">评分 (最高)</option>
              <option value="title">名称 (A-Z)</option>
            </select>
          </div>

          <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-neutral-800 text-cyan-400' : 'text-neutral-500 hover:text-neutral-300'}`}
              title="网格视图"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-neutral-800 text-cyan-400' : 'text-neutral-500 hover:text-neutral-300'}`}
              title="列表视图"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>

      {/* Empty State */}
      {sortedItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 mb-4">
            <FileAudio className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-neutral-200">没有找到音频素材</h3>
          <p className="text-xs text-neutral-400 max-w-sm mt-1">
            当前分类或筛选条件下没有素材。您可以点击顶部导航栏尝试“AI语音合成”、“智能音效”或“录音”创建全新声音！
          </p>
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pt-6">
          {sortedItems.map((item) => {
            const isItemPlaying = currentlyPlayingId === item.id && isPlaying;
            const isSelected = selectedIds.includes(item.id);
            const catMeta = getCategoryMeta(item.category);
            const CategoryIcon = catMeta.icon;
            const peaks = item.waveformData || [0.4, 0.6, 0.8, 0.3, 0.7, 0.5, 0.9, 0.4];

            return (
              <div
                key={item.id}
                className={`group relative bg-neutral-900/60 rounded-xl border transition-all hover:bg-neutral-900/90 hover:border-neutral-700/80 p-4 flex flex-col justify-between ${
                  isSelected ? 'border-cyan-500/50 bg-cyan-950/10' : 'border-neutral-800/80'
                }`}
              >
                {/* Header row */}
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleSelectOne(item.id)}
                        className="text-neutral-500 hover:text-cyan-400 shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-cyan-400" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>

                      {/* Category Badge */}
                      <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${catMeta.badgeClass}`}>
                        <CategoryIcon className="w-3 h-3" />
                        <span>{catMeta.label}</span>
                      </span>

                      {/* Folder indicator if assigned */}
                      {item.folderId && (
                        <span className="text-[10px] text-neutral-400 font-medium truncate">
                          📁 {folders.find(f => f.id === item.folderId)?.name || '文件夹'}
                        </span>
                      )}
                    </div>

                    {/* Star Rating */}
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => onUpdateRating(item.id, star === item.rating ? 0 : star)}
                          className="text-neutral-600 hover:text-amber-400 transition-colors p-0.5"
                        >
                          <Star
                            className={`w-3 h-3 ${star <= (item.rating || 0) ? 'text-amber-400 fill-amber-400' : ''}`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h4 className="font-semibold text-sm text-neutral-100 group-hover:text-cyan-300 transition-colors line-clamp-1 mb-1" title={item.title}>
                    {item.title}
                  </h4>
                  {item.description && (
                    <p className="text-xs text-neutral-400 line-clamp-2 mb-3">
                      {item.description}
                    </p>
                  )}
                </div>

                {/* Waveform Bar & Play Trigger */}
                <div className="my-3">
                  <div
                    onClick={() => onPlayPause(item)}
                    className="relative h-12 bg-neutral-950/70 border border-neutral-800 rounded-lg flex items-center px-3 gap-1 cursor-pointer overflow-hidden hover:border-cyan-500/40 transition-colors"
                  >
                    {/* Visualizer Peak Bars */}
                    <div className="flex-1 flex items-center justify-between gap-[2px] h-8">
                      {peaks.slice(0, 36).map((val, idx) => (
                        <div
                          key={idx}
                          className={`w-[2.5px] rounded-full transition-all duration-150 ${
                            isItemPlaying ? 'bg-cyan-400 animate-pulse' : 'bg-neutral-600 group-hover:bg-neutral-500'
                          }`}
                          style={{ height: `${Math.max(15, val * 100)}%` }}
                        />
                      ))}
                    </div>

                    {/* Play/Pause Button Pill */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayPause(item);
                      }}
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-md transition-transform active:scale-95 ${
                        isItemPlaying ? 'bg-cyan-500 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-200 hover:bg-cyan-500 hover:text-neutral-950'
                      }`}
                    >
                      {isItemPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                    </button>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {item.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-2 py-0.5 rounded bg-neutral-800/80 text-neutral-400 border border-neutral-700/50"
                    >
                      #{tag}
                    </span>
                  ))}
                  {item.tags.length > 4 && (
                    <span className="text-[10px] px-1 text-neutral-400">+{item.tags.length - 4}</span>
                  )}
                </div>

                {/* Footer Info & Action Icons */}
                <div className="flex items-center justify-between pt-2 border-t border-neutral-800/60 text-[11px] text-neutral-400">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="flex items-center gap-1 text-neutral-300">
                      <Clock className="w-3 h-3 text-cyan-400" />
                      {formatDuration(item.duration)}
                    </span>
                    <span>•</span>
                    <span>{formatBytes(item.fileSize)}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Open in Editor */}
                    <button
                      onClick={() => onOpenEditor(item)}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-cyan-300 transition-colors"
                      title="在音频编辑器中剪辑与调音"
                    >
                      <Scissors className="w-3.5 h-3.5" />
                    </button>

                    {/* Transcribe */}
                    <button
                      onClick={() => onOpenTranscribe(item)}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-indigo-300 transition-colors"
                      title="AI语音转录与情绪分析"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>

                    {/* Subtitle SRT/VTT Export */}
                    {onOpenSubtitleExport && (
                      <button
                        onClick={() => onOpenSubtitleExport(item)}
                        className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-cyan-300 transition-colors"
                        title="生成与导出 SRT/VTT 字幕"
                      >
                        <FileAudio className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Auto Tag */}
                    <button
                      onClick={() => onAutoTag(item)}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-fuchsia-300 transition-colors"
                      title="AI智能分类与推荐标签"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>

                    {/* Download */}
                    <button
                      onClick={() => onDownload(item)}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-emerald-300 transition-colors"
                      title="导出标准 WAV 文件"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => {
                        if (confirm(`确定删除音频 "${item.title}" 吗？`)) {
                          onDelete(item.id);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-rose-400 transition-colors"
                      title="删除音频素材"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="pt-4 space-y-2">
          {sortedItems.map((item) => {
            const isItemPlaying = currentlyPlayingId === item.id && isPlaying;
            const isSelected = selectedIds.includes(item.id);
            const catMeta = getCategoryMeta(item.category);
            const CategoryIcon = catMeta.icon;

            return (
              <div
                key={item.id}
                className={`group flex items-center justify-between gap-4 p-3 rounded-xl border bg-neutral-900/60 hover:bg-neutral-900/90 transition-all ${
                  isSelected ? 'border-cyan-500/50 bg-cyan-950/10' : 'border-neutral-800/80'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    onClick={() => toggleSelectOne(item.id)}
                    className="text-neutral-500 hover:text-cyan-400 shrink-0"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-cyan-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>

                  <button
                    onClick={() => onPlayPause(item)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm transition-transform active:scale-95 ${
                      isItemPlaying ? 'bg-cyan-500 text-neutral-950 font-bold' : 'bg-neutral-800 text-neutral-200 hover:bg-cyan-500 hover:text-neutral-950'
                    }`}
                  >
                    {isItemPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${catMeta.badgeClass}`}>
                        <CategoryIcon className="w-3 h-3" />
                        <span>{catMeta.label}</span>
                      </span>
                      <h4 className="font-semibold text-xs text-neutral-100 truncate group-hover:text-cyan-300">
                        {item.title}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      {item.tags.map((t) => (
                        <span key={t} className="text-[10px] text-neutral-400">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-right font-mono text-xs text-neutral-400">
                    <div>{formatDuration(item.duration)}</div>
                    <div className="text-[10px] text-neutral-400">{formatBytes(item.fileSize)}</div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onOpenEditor(item)}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-cyan-300 transition-colors"
                      title="在音频编辑器中剪辑与调音"
                    >
                      <Scissors className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onOpenTranscribe(item)}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-indigo-300 transition-colors"
                      title="AI语音转录"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    {onOpenSubtitleExport && (
                      <button
                        onClick={() => onOpenSubtitleExport(item)}
                        className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-cyan-300 transition-colors"
                        title="生成与导出 SRT/VTT 字幕"
                      >
                        <FileAudio className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => onDownload(item)}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-emerald-300 transition-colors"
                      title="导出 WAV"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`确定删除 "${item.title}" 吗？`)) {
                          onDelete(item.id);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-rose-400 transition-colors"
                      title="删除音频"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Batch Move to Folder Modal */}
      {showMoveFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-semibold text-neutral-100">移动选中的音频至文件夹</h3>
            <p className="text-xs text-neutral-400">选择目标文件夹以整理已选中的 {selectedIds.length} 个音频文件：</p>
            
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              <button
                onClick={() => {
                  onBatchMoveFolder(selectedIds, undefined);
                  setShowMoveFolderModal(false);
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-neutral-300 hover:bg-neutral-800 flex items-center gap-2"
              >
                <span>📂 移出文件夹 (设为未分组)</span>
              </button>
              {folders.map(f => (
                <button
                  key={f.id}
                  onClick={() => {
                    onBatchMoveFolder(selectedIds, f.id);
                    setShowMoveFolderModal(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-neutral-300 hover:bg-neutral-800 flex items-center gap-2"
                >
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.color }} />
                  <span>{f.name}</span>
                </button>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowMoveFolderModal(false)}
                className="px-4 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Add Tags Modal */}
      {showBatchTagModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-semibold text-neutral-100">批量添加标签</h3>
            <p className="text-xs text-neutral-400">输入需要批量附加的标签（多个标签请用空格或逗号分隔）：</p>
            
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              placeholder="例如: 科技感 广告 爆款配音"
              className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-cyan-500"
              autoFocus
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowBatchTagModal(false)}
                className="px-4 py-1.5 text-xs text-neutral-400 hover:text-neutral-200"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const tags = newTagInput.split(/[\s,，]+/).map(t => t.trim()).filter(Boolean);
                  if (tags.length > 0) {
                    onBatchAddTags(selectedIds, tags);
                  }
                  setNewTagInput('');
                  setShowBatchTagModal(false);
                }}
                className="px-4 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium"
              >
                确定添加
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
