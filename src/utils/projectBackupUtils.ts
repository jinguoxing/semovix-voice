import JSZip from 'jszip';
import { AudioItem, AudioFolder } from '../types/audio';
import { addAudioItem, extractPeaks } from './audioStorage';

export interface ProjectBackupMetadata {
  version: string;
  appName: string;
  exportedAt: string;
  totalItems: number;
  folders: AudioFolder[];
  itemsMeta: Array<Omit<AudioItem, 'audioUrl' | 'peaks'> & { filename: string }>;
}

/**
 * Packs all library items, categories, and tags into an offline ZIP archive
 */
export async function exportProjectToZip(
  items: AudioItem[],
  folders: AudioFolder[],
  onProgress?: (progress: number, statusText: string) => void
): Promise<Blob> {
  const zip = new JSZip();
  const audioFolder = zip.folder('audio_files');

  const itemsMeta: ProjectBackupMetadata['itemsMeta'] = [];

  let processed = 0;
  const total = items.length;

  for (const item of items) {
    if (onProgress) {
      onProgress((processed / (total || 1)) * 0.8, `正在打包: ${item.title}`);
    }

    const safeTitle = item.title.replace(/[/\\?%*:|"<>]/g, '_').trim() || `item_${item.id}`;
    const filename = `${safeTitle}_${item.id.slice(0, 8)}.wav`;

    try {
      const response = await fetch(item.audioUrl);
      const blob = await response.blob();
      audioFolder?.file(filename, blob);

      const { audioUrl, waveformData, ...meta } = item;
      itemsMeta.push({
        ...meta,
        filename,
      });
    } catch (e) {
      console.warn(`Could not add audio file ${item.title} to zip`, e);
    }
    processed++;
  }

  const projectMetadata: ProjectBackupMetadata = {
    version: '1.0.0',
    appName: 'AudioCraft Studio',
    exportedAt: new Date().toISOString(),
    totalItems: itemsMeta.length,
    folders,
    itemsMeta,
  };

  zip.file('project.json', JSON.stringify(projectMetadata, null, 2));

  if (onProgress) {
    onProgress(0.85, '正在压缩生成 ZIP 工程包...');
  }

  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    },
    (metadata) => {
      if (onProgress) {
        onProgress(0.85 + (metadata.percent / 100) * 0.15, `压缩中: ${Math.round(metadata.percent)}%`);
      }
    }
  );

  return zipBlob;
}

/**
 * Unpacks an imported ZIP project archive back into AudioItems and Folders
 */
export async function importProjectFromZip(
  file: File,
  onProgress?: (progress: number, statusText: string) => void
): Promise<{ items: AudioItem[]; folders: AudioFolder[] }> {
  const zip = await JSZip.loadAsync(file);

  const metaFile = zip.file('project.json');
  if (!metaFile) {
    throw new Error('无效的工程归档文件：缺少 project.json 元数据清单。');
  }

  const metaText = await metaFile.async('text');
  const metadata: ProjectBackupMetadata = JSON.parse(metaText);

  const importedItems: AudioItem[] = [];
  const total = metadata.itemsMeta.length;
  let current = 0;

  for (const meta of metadata.itemsMeta) {
    if (onProgress) {
      onProgress((current / (total || 1)) * 0.9, `正在还原音频: ${meta.title}`);
    }

    const audioFile = zip.file(`audio_files/${meta.filename}`);
    if (audioFile) {
      const blob = await audioFile.async('blob');
      const waveformData = await extractPeaks(blob, 48);

      // 直接上传到服务端素材库，拿到持久化的 audioUrl
      const restoredItem = await addAudioItem(
        {
          ...meta,
          id: meta.id || `restored_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          audioUrl: '',
          waveformData,
          createdAt: meta.createdAt || new Date().toISOString(),
        } as AudioItem,
        blob,
      );

      importedItems.push(restoredItem);
    }
    current++;
  }

  return {
    items: importedItems,
    folders: metadata.folders || [],
  };
}
