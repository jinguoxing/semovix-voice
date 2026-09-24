/**
 * AudioCraft Studio - Main Application Entry
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Navbar, StudioTab } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { AudioLibraryView } from './components/AudioLibraryView';
import { AudioTTSStudio } from './components/AudioTTSStudio';
import { AudioSFXStudio } from './components/AudioSFXStudio';
import { AudioBeatStudio } from './components/AudioBeatStudio';
import { MultiTrackMixerStudio } from './components/MultiTrackMixerStudio';
import { AudioEditorModal } from './components/AudioEditorModal';
import { AudioRecorderModal } from './components/AudioRecorderModal';
import { AudioImportModal } from './components/AudioImportModal';
import { AudioTranscribeModal } from './components/AudioTranscribeModal';
import { SubtitleExportModal } from './components/SubtitleExportModal';
import { ProjectBackupModal } from './components/ProjectBackupModal';
import { VoiceModelConfigModal } from './components/VoiceModelConfigModal';
import { GlobalPlayer } from './components/GlobalPlayer';

import { AudioItem, AudioFolder } from './types/audio';
import { 
  getAudioItems, 
  addAudioItem,
  updateAudioItem,
  overwriteAudioFile,
  deleteAudioItem, 
  deleteMultipleAudioItems, 
  moveAudioToFolder, 
  batchAddTags, 
  getFolders, 
  createFolder, 
  deleteFolder 
} from './utils/audioStorage';
import { getAudioContext } from './utils/audioEngine';

export default function App() {
  const [items, setItems] = useState<AudioItem[]>([]);
  const [folders, setFolders] = useState<AudioFolder[]>([]);
  const [currentTab, setCurrentTab] = useState<StudioTab>('library');
  const [searchQuery, setSearchQuery] = useState('');

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  // Playback
  const [activeItem, setActiveItem] = useState<AudioItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Modals
  const [editingItem, setEditingItem] = useState<AudioItem | null>(null);
  const [transcribingItem, setTranscribingItem] = useState<AudioItem | null>(null);
  const [subtitleItem, setSubtitleItem] = useState<AudioItem | null>(null);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isVoiceModelConfigOpen, setIsVoiceModelConfigOpen] = useState(false);
  const [isProjectBackupOpen, setIsProjectBackupOpen] = useState(false);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      const storedItems = await getAudioItems();
      setItems(storedItems);
      const loadedFolders = await getFolders();
      setFolders(loadedFolders);
    }
    loadData();
  }, []);

  // Tag frequency analysis
  const allTagsWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(item => {
      item.tags.forEach(t => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(item => {
      counts[item.category] = (counts[item.category] || 0) + 1;
    });
    return counts;
  }, [items]);

  // Total duration in seconds
  const totalDurationSeconds = useMemo(() => {
    return items.reduce((acc, i) => acc + (i.duration || 0), 0);
  }, [items]);

  // Filtered Items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Category filter
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      // Folder filter
      if (selectedFolderId && item.folderId !== selectedFolderId) {
        return false;
      }
      // Favorites filter
      if (onlyFavorites && (item.rating || 0) < 4) {
        return false;
      }
      // Tags filter
      if (selectedTags.length > 0) {
        const hasAllTags = selectedTags.every(t => item.tags.includes(t));
        if (!hasAllTags) return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q);
        const matchTranscript = item.transcript?.toLowerCase().includes(q);
        const matchTag = item.tags.some(t => t.toLowerCase().includes(q));
        if (!matchTitle && !matchDesc && !matchTranscript && !matchTag) {
          return false;
        }
      }
      return true;
    });
  }, [items, selectedCategory, selectedFolderId, onlyFavorites, selectedTags, searchQuery]);

  // Player controls
  const handlePlayPause = (item: AudioItem) => {
    getAudioContext(); // user gesture unlock
    if (activeItem?.id === item.id) {
      setIsPlaying(!isPlaying);
    } else {
      setActiveItem(item);
      setIsPlaying(true);
    }
  };

  const handleToggleGlobalPlay = () => {
    getAudioContext();
    setIsPlaying(!isPlaying);
  };

  const handleCloseGlobalPlayer = () => {
    setIsPlaying(false);
    setActiveItem(null);
  };

  // CRUD Operations
  const handleSaveToLibrary = async (newItem: AudioItem, blob?: Blob) => {
    const saved = await addAudioItem(newItem, blob);
    setItems(prev => [saved, ...prev]);
  };

  const handleUpdateItem = async (id: string, updates: Partial<AudioItem>) => {
    // PATCH 契约返回单个更新后的 item；本地合并保持列表状态一致
    const updated = await updateAudioItem(id, updates);
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...updated } : it)));
    if (activeItem?.id === id) {
      setActiveItem({ ...activeItem, ...updated });
    }
  };

  const handleDeleteItem = async (id: string) => {
    const updated = await deleteAudioItem(id);
    setItems(updated);
    if (activeItem?.id === id) {
      setActiveItem(null);
      setIsPlaying(false);
    }
  };

  const handleBatchDelete = async (ids: string[]) => {
    const updated = await deleteMultipleAudioItems(ids);
    setItems(updated);
    if (activeItem && ids.includes(activeItem.id)) {
      setActiveItem(null);
      setIsPlaying(false);
    }
  };

  const handleBatchMoveFolder = async (ids: string[], folderId?: string) => {
    const updated = await moveAudioToFolder(ids, folderId);
    setItems(updated);
  };

  const handleBatchAddTags = async (ids: string[], newTags: string[]) => {
    const updated = await batchAddTags(ids, newTags);
    setItems(updated);
  };

  const handleUpdateRating = async (id: string, rating: number) => {
    handleUpdateItem(id, { rating });
  };

  // 编辑器“覆盖原素材”：先真正覆盖服务端音频文件，再合并元数据（P01 数据完整性）
  const handleOverwriteAudioItem = async (
    id: string,
    updates: Partial<AudioItem>,
    blob?: Blob,
  ) => {
    if (blob) {
      const updated = await overwriteAudioFile(id, blob, {
        duration: updates.duration,
      });
      setItems(prev => prev.map(it => (it.id === id ? { ...it, ...updated } : it)));
      if (activeItem?.id === id) setActiveItem(prev => (prev ? { ...prev, ...updated } : prev));
    }
    // audioUrl 是 DSP 产生的本地 blob: URL，不应写入服务端元数据；其余字段照常 PATCH
    const { audioUrl: _drop, ...metaOnly } = updates;
    void _drop;
    await handleUpdateItem(id, metaOnly);
  };

  const handleDownload = (item: AudioItem) => {
    const a = document.createElement('a');
    a.href = item.audioUrl;
    a.download = `${item.title || 'audio'}.${item.format || 'wav'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Folder Operations
  const handleCreateFolder = async (name: string, color?: string) => {
    try {
      const newFolder = await createFolder(name, color);
      setFolders(prev => [...prev, newFolder]);
    } catch (e) {
      console.error('创建文件夹失败', e);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    try {
      const updated = await deleteFolder(id);
      setFolders(updated);
      if (selectedFolderId === id) {
        setSelectedFolderId(undefined);
      }
    } catch (e) {
      console.error('删除文件夹失败', e);
    }
  };

  // Auto Tag with Gemini API
  const handleAutoTag = async (item: AudioItem) => {
    try {
      const res = await fetch('/api/auto-tag-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          description: item.description,
          category: item.category,
          transcript: item.transcript,
        }),
      });
      const data = await res.json();
      if (data.tags && data.tags.length > 0) {
        const merged = Array.from(new Set([...item.tags, ...data.tags]));
        handleUpdateItem(item.id, { tags: merged });
      }
    } catch (e) {
      console.error('Auto tag error', e);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
      
      {/* Top Navbar */}
      <Navbar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenRecorder={() => setIsRecorderOpen(true)}
        onOpenImporter={() => setIsImporterOpen(true)}
        onOpenVoiceModelConfig={() => setIsVoiceModelConfigOpen(true)}
        onOpenProjectBackup={() => setIsProjectBackupOpen(true)}
        totalItems={items.length}
        totalDurationSeconds={totalDurationSeconds}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden" data-player-visible={Boolean(activeItem)}>
        
        {/* Left Sidebar (Only visible in library view) */}
        {currentTab === 'library' && (
          <Sidebar
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            folders={folders}
            onCreateFolder={handleCreateFolder}
            onDeleteFolder={handleDeleteFolder}
            selectedTags={selectedTags}
            onToggleTag={(t) => {
              setSelectedTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
            }}
            allTags={allTagsWithCounts}
            onlyFavorites={onlyFavorites}
            onToggleOnlyFavorites={() => setOnlyFavorites(!onlyFavorites)}
            categoryCounts={categoryCounts}
            totalCount={items.length}
          />
        )}

        {/* Dynamic Studio Views */}
        <main className="flex-1 flex min-w-0 overflow-hidden">
          {currentTab === 'library' && (
            <AudioLibraryView
              items={filteredItems}
              folders={folders}
              currentlyPlayingId={isPlaying ? activeItem?.id || null : null}
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              onOpenEditor={(item) => setEditingItem(item)}
              onOpenTranscribe={(item) => setTranscribingItem(item)}
              onOpenSubtitleExport={(item) => setSubtitleItem(item)}
              onAutoTag={handleAutoTag}
              onDelete={handleDeleteItem}
              onBatchDelete={handleBatchDelete}
              onBatchMoveFolder={handleBatchMoveFolder}
              onBatchAddTags={handleBatchAddTags}
              onUpdateRating={handleUpdateRating}
              onDownload={handleDownload}
            />
          )}

          {currentTab === 'tts' && (
            <AudioTTSStudio
              folders={folders}
              onSaveToLibrary={handleSaveToLibrary}
              onOpenEditor={(item) => setEditingItem(item)}
              onOpenVoiceModelConfig={() => setIsVoiceModelConfigOpen(true)}
            />
          )}

          {currentTab === 'sfx' && (
            <AudioSFXStudio
              folders={folders}
              onSaveToLibrary={handleSaveToLibrary}
              onOpenEditor={(item) => setEditingItem(item)}
            />
          )}

          {currentTab === 'beat' && (
            <AudioBeatStudio
              items={items}
              folders={folders}
              onSaveToLibrary={handleSaveToLibrary}
              onOpenEditor={(item) => setEditingItem(item)}
            />
          )}

          {currentTab === 'multitrack' && (
            <MultiTrackMixerStudio
              items={items}
              folders={folders}
              onSaveToLibrary={handleSaveToLibrary}
              onOpenEditor={(item) => setEditingItem(item)}
            />
          )}
        </main>
      </div>

      {/* Global Persistent Bottom Audio Player Bar */}
      <GlobalPlayer
        item={activeItem}
        isPlaying={isPlaying}
        onTogglePlay={handleToggleGlobalPlay}
        onClose={handleCloseGlobalPlayer}
        onOpenEditor={(item) => setEditingItem(item)}
      />

      {/* Audio Editor Modal */}
      {editingItem && (
        <AudioEditorModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaveAsNew={(newItem, blob) => handleSaveToLibrary(newItem, blob)}
          onOverwrite={(id, updates, blob) => handleOverwriteAudioItem(id, updates, blob)}
        />
      )}

      {/* Mic Recorder Modal */}
      {isRecorderOpen && (
        <AudioRecorderModal
          folders={folders}
          onClose={() => setIsRecorderOpen(false)}
          onSaveToLibrary={(item, blob) => handleSaveToLibrary(item, blob)}
        />
      )}

      {/* File Import Modal */}
      {isImporterOpen && (
        <AudioImportModal
          folders={folders}
          onClose={() => setIsImporterOpen(false)}
          onSaveToLibrary={(item, blob) => handleSaveToLibrary(item, blob)}
        />
      )}

      {/* Speech-to-Text & Transcribe Modal */}
      {transcribingItem && (
        <AudioTranscribeModal
          item={transcribingItem}
          onClose={() => setTranscribingItem(null)}
          onUpdateItem={handleUpdateItem}
        />
      )}

      {/* Voice Large Language Model Configuration Modal */}
      <VoiceModelConfigModal
        isOpen={isVoiceModelConfigOpen}
        onClose={() => setIsVoiceModelConfigOpen(false)}
      />

      {/* Subtitle SRT / VTT Export Modal */}
      {subtitleItem && (
        <SubtitleExportModal
          item={subtitleItem}
          isOpen={!!subtitleItem}
          onClose={() => setSubtitleItem(null)}
        />
      )}

      {/* Project Backup & Restore Modal */}
      <ProjectBackupModal
        isOpen={isProjectBackupOpen}
        onClose={() => setIsProjectBackupOpen(false)}
        items={items}
        folders={folders}
        onProjectRestored={(restoredItems, restoredFolders) => {
          setItems(restoredItems);
          setFolders(restoredFolders);
        }}
      />

    </div>
  );
}
