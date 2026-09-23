/**
 * Subtitle and Export Utilities for AudioCraft Studio
 * Supports .SRT, .VTT, and Timestamp formatting
 */

export interface SubtitleCue {
  id: number;
  startTime: number; // in seconds
  endTime: number; // in seconds
  speaker?: string;
  text: string;
}

/**
 * Format seconds to SRT time string: HH:MM:SS,mmm
 */
export function formatSecondsToSrtTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 1000);

  const pad = (n: number, z = 2) => ('00' + n).slice(-z);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(milliseconds, 3)}`;
}

/**
 * Format seconds to WebVTT time string: HH:MM:SS.mmm
 */
export function formatSecondsToVttTime(totalSeconds: number): string {
  return formatSecondsToSrtTime(totalSeconds).replace(',', '.');
}

/**
 * Generates standard SRT subtitle text
 */
export function generateSrtContent(cues: SubtitleCue[]): string {
  return cues
    .map((cue, index) => {
      const cueNum = index + 1;
      const start = formatSecondsToSrtTime(cue.startTime);
      const end = formatSecondsToSrtTime(cue.endTime);
      const text = cue.speaker ? `[${cue.speaker}]: ${cue.text}` : cue.text;
      return `${cueNum}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
}

/**
 * Generates WebVTT subtitle text
 */
export function generateVttContent(cues: SubtitleCue[]): string {
  const header = 'WEBVTT\n\n';
  const body = cues
    .map((cue, index) => {
      const cueNum = index + 1;
      const start = formatSecondsToVttTime(cue.startTime);
      const end = formatSecondsToVttTime(cue.endTime);
      const text = cue.speaker ? `<v ${cue.speaker}>${cue.text}</v>` : cue.text;
      return `${cueNum}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
  return header + body;
}

/**
 * Automatically segments raw text or dialogue into timed subtitle cues based on audio duration
 */
export function autoSegmentSubtitles(rawText: string, totalDuration: number): SubtitleCue[] {
  if (!rawText || !rawText.trim()) return [];

  // Split lines or sentences
  const lines = rawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  let segments: Array<{ speaker?: string; text: string }> = [];

  for (const line of lines) {
    // Check if it's formatted like "主持人: 内容" or "Speaker: content"
    const match = line.match(/^([^:：]{1,10})[:：]\s*(.+)$/);
    if (match) {
      segments.push({ speaker: match[1], text: match[2] });
    } else {
      // Split by common punctuation
      const subClauses = line.split(/([。！？；]+)/).filter(Boolean);
      let combined = '';
      for (let i = 0; i < subClauses.length; i++) {
        combined += subClauses[i];
        if (combined.length > 18 || i === subClauses.length - 1) {
          if (combined.trim()) {
            segments.push({ text: combined.trim() });
          }
          combined = '';
        }
      }
      if (combined.trim()) {
        segments.push({ text: combined.trim() });
      }
    }
  }

  if (segments.length === 0) {
    segments = [{ text: rawText }];
  }

  // Calculate weighted duration based on character length
  const totalChars = segments.reduce((sum, seg) => sum + seg.text.length, 0) || 1;
  let currentStart = 0.2; // slight pre-roll
  const usableDuration = Math.max(1, totalDuration - 0.5);

  const cues: SubtitleCue[] = segments.map((seg, idx) => {
    const fraction = seg.text.length / totalChars;
    const dur = Math.max(1.2, fraction * usableDuration);
    const end = Math.min(totalDuration, currentStart + dur);
    const cue: SubtitleCue = {
      id: idx + 1,
      startTime: currentStart,
      endTime: end,
      speaker: seg.speaker,
      text: seg.text,
    };
    currentStart = end + 0.1;
    return cue;
  });

  return cues;
}

/**
 * Trigger file download helper
 */
export function downloadTextFile(content: string, filename: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
