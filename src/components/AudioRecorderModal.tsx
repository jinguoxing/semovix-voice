import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Mic, 
  Square, 
  Play, 
  Pause, 
  RotateCcw, 
  Save, 
  Volume2, 
  FolderPlus, 
  Radio
} from 'lucide-react';
import { AudioItem, AudioFolder } from '../types/audio';
import { getAudioContext, audioBufferToWav, extractPeaks } from '../utils/audioEngine';

interface AudioRecorderModalProps {
  folders: AudioFolder[];
  onClose: () => void;
  onSaveToLibrary: (item: AudioItem, blob: Blob) => void;
}

export const AudioRecorderModal: React.FC<AudioRecorderModalProps> = ({
  folders,
  onClose,
  onSaveToLibrary,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBuffer, setRecordedBuffer] = useState<AudioBuffer | null>(null);
  const [title, setTitle] = useState(`现场人声录音-${new Date().toLocaleDateString()}`);
  const [selectedFolderId, setSelectedFolderId] = useState<string>(folders[0]?.id || '');
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Start Mic Recording
  const startRecording = async () => {
    try {
      setMicError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      streamRef.current = stream;

      // Audio analysis for oscilloscope
      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const rawBlob = new Blob(chunks, { type: 'audio/webm' });
        // Decode to AudioBuffer to convert to standard 16-bit WAV
        try {
          const arrayBuffer = await rawBlob.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuffer);
          const wavBlob = audioBufferToWav(decoded);
          const url = URL.createObjectURL(wavBlob);
          setRecordedBlob(wavBlob);
          setRecordedUrl(url);
          setRecordedBuffer(decoded);
        } catch {
          const url = URL.createObjectURL(rawBlob);
          setRecordedBlob(rawBlob);
          setRecordedUrl(url);
        }
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setElapsedTime(0);

      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        setElapsedTime((Date.now() - startTime) / 1000);
      }, 50);

      // Start oscilloscope rendering loop
      drawOscilloscope();
    } catch (err: any) {
      console.error('Microphone access denied', err);
      setMicError('无法访问麦克风设备，请确认已在浏览器中授予麦克风权限。');
    }
  };

  // Draw real-time audio waveform / spectrum
  const drawOscilloscope = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.2;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.9;

        // Gradient color from cyan to rose
        const r = Math.min(255, 34 + dataArray[i]);
        const g = Math.min(255, 211 - dataArray[i] * 0.3);
        const b = 238;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };
    render();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setIsRecording(false);
  };

  useEffect(() => {
    return () => {
      stopRecording();
      if (previewAudioRef.current) previewAudioRef.current.pause();
    };
  }, []);

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}.${ms}`;
  };

  const togglePreview = () => {
    if (!recordedUrl) return;
    if (isPlayingPreview && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      const audio = new Audio(recordedUrl);
      audio.onended = () => setIsPlayingPreview(false);
      audio.play();
      previewAudioRef.current = audio;
      setIsPlayingPreview(true);
    }
  };

  const handleSave = () => {
    if (!recordedBlob || !recordedUrl) return;

    const duration = recordedBuffer ? recordedBuffer.duration : elapsedTime;
    const peaks = recordedBuffer ? extractPeaks(recordedBuffer, 48) : [0.4, 0.7, 0.5, 0.8, 0.3, 0.6];

    const newItem: AudioItem = {
      id: `rec-${Date.now()}`,
      title: title.trim() || '未命名麦克风录音',
      category: 'recording',
      duration: Math.round(duration * 10) / 10,
      sampleRate: recordedBuffer?.sampleRate || 44100,
      channels: 1,
      format: 'wav',
      fileSize: recordedBlob.size,
      createdAt: new Date().toISOString(),
      tags: ['录音', '人声', '原声素材'],
      rating: 5,
      folderId: selectedFolderId || undefined,
      audioUrl: recordedUrl,
      waveformData: peaks,
      metadata: { source: 'mic-recording' },
    };

    onSaveToLibrary(newItem, recordedBlob);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg p-6 space-y-6 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-rose-500 animate-pulse" />
            <h3 className="text-base font-bold text-neutral-100">录音棚 (Live Voice Recorder)</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error message */}
        {micError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
            {micError}
          </div>
        )}

        {/* Oscilloscope Canvas */}
        <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 text-center space-y-3">
          <canvas
            ref={canvasRef}
            width={400}
            height={90}
            className="w-full h-24 rounded-xl bg-neutral-950 block mx-auto"
          />

          {/* Timecode display */}
          <div className="font-mono text-3xl font-extrabold text-neutral-100 tracking-wider">
            {formatTime(elapsedTime)}
          </div>
          <span className="text-xs text-neutral-400">
            {isRecording ? '正在进行高保真录制...' : recordedUrl ? '录音完成，可直接试听或保存' : '准备就绪，点击下方录制按钮启动'}
          </span>
        </div>

        {/* Recorder Transport Buttons */}
        <div className="flex items-center justify-center gap-4">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="px-6 py-3 rounded-full font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950/60 flex items-center gap-2 transition-all active:scale-95"
            >
              <Mic className="w-4 h-4 fill-current" />
              <span>{recordedUrl ? '重新录制' : '开始录音'}</span>
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="px-6 py-3 rounded-full font-bold text-xs bg-neutral-800 hover:bg-neutral-700 text-rose-400 border border-rose-500/40 flex items-center gap-2 transition-all active:scale-95"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>停止并完成</span>
            </button>
          )}

          {recordedUrl && !isRecording && (
            <button
              onClick={togglePreview}
              className="px-5 py-3 rounded-full font-bold text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center gap-2 transition-all active:scale-95"
            >
              {isPlayingPreview ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>暂停试听</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>试听回放</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Save Form */}
        {recordedUrl && (
          <div className="pt-3 border-t border-neutral-800 space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                素材标题
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-neutral-400 block mb-1">
                保存至文件夹
              </label>
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-neutral-200 focus:outline-none"
              >
                <option value="">未分类</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs text-neutral-400 hover:text-neutral-200"
              >
                放弃
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-950/40 flex items-center gap-1.5 transition-all active:scale-95"
              >
                <Save className="w-3.5 h-3.5" />
                <span>存入素材库</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
