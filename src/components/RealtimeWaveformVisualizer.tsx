import React, { useEffect, useRef, useState } from 'react';

export type VisualizerMode = 'waveform' | 'spectrum' | 'aurora';
export type VisualizerTheme = 'cyan' | 'violet' | 'emerald';

interface RealtimeWaveformVisualizerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  mode?: VisualizerMode;
  theme?: VisualizerTheme;
  height?: number;
  sensitivity?: number;
  showVuMeter?: boolean;
  className?: string;
}

export const RealtimeWaveformVisualizer: React.FC<RealtimeWaveformVisualizerProps> = ({
  analyser,
  isPlaying,
  mode = 'waveform',
  theme = 'cyan',
  height = 40,
  sensitivity = 1.0,
  showVuMeter = false,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  
  // Peak hold data for spectrum bars
  const peaksRef = useRef<number[]>([]);
  const peakDecayRef = useRef<number[]>([]);

  // Real-time VU meter values
  const [peakDb, setPeakDb] = useState<number>(-60);
  const [rmsDb, setRmsDb] = useState<number>(-60);

  // Theme palettes
  const getThemeColors = (t: VisualizerTheme) => {
    switch (t) {
      case 'violet':
        return {
          primary: '#a855f7',
          secondary: '#ec4899',
          glow: 'rgba(168, 85, 247, 0.45)',
          fillTop: 'rgba(168, 85, 247, 0.25)',
          fillBottom: 'rgba(236, 72, 153, 0.05)',
          peakDot: '#f472b6',
        };
      case 'emerald':
        return {
          primary: '#10b981',
          secondary: '#06b6d4',
          glow: 'rgba(16, 185, 129, 0.45)',
          fillTop: 'rgba(16, 185, 129, 0.25)',
          fillBottom: 'rgba(6, 182, 212, 0.05)',
          peakDot: '#34d399',
        };
      case 'cyan':
      default:
        return {
          primary: '#06b6d4',
          secondary: '#6366f1',
          glow: 'rgba(6, 182, 212, 0.45)',
          fillTop: 'rgba(6, 182, 212, 0.25)',
          fillBottom: 'rgba(99, 102, 241, 0.05)',
          peakDot: '#38bdf8',
        };
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let time = 0;

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const targetWidth = Math.floor(rect.width * dpr);
      const targetHeight = Math.floor(rect.height * dpr);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      const width = rect.width;
      const h = rect.height;

      // Clear with transparent or deep backdrop
      ctx.clearRect(0, 0, width, h);

      const colors = getThemeColors(theme);
      time += 0.04;

      // When analyser is not available or audio is paused, draw soft resting state
      if (!analyser || !isPlaying) {
        // Idle gentle breathing line
        ctx.beginPath();
        const centerY = h / 2;
        ctx.moveTo(0, centerY);
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
          const x = (i / steps) * width;
          const subtleWave = isPlaying ? 0 : Math.sin(time + i * 0.2) * 1.5;
          ctx.lineTo(x, centerY + subtleWave);
        }
        ctx.strokeStyle = 'rgba(115, 115, 115, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        return;
      }

      // We have active analyser data
      const bufferLength = analyser.frequencyBinCount;

      if (mode === 'waveform') {
        // Time Domain (Waveform Oscilloscope)
        const timeData = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(timeData);

        // Calculate Peak & RMS for VU Meter
        let sumSquares = 0;
        let maxVal = 0;
        for (let i = 0; i < bufferLength; i++) {
          const norm = (timeData[i] - 128) / 128;
          sumSquares += norm * norm;
          const abs = Math.abs(norm);
          if (abs > maxVal) maxVal = abs;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
        const currentPeakDb = maxVal > 0.0001 ? Math.max(-60, 20 * Math.log10(maxVal)) : -60;
        const currentRmsDb = rms > 0.0001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
        setPeakDb(prev => prev * 0.85 + currentPeakDb * 0.15);
        setRmsDb(prev => prev * 0.85 + currentRmsDb * 0.15);

        // Draw waveform path
        const sliceWidth = width / bufferLength;
        const centerY = h / 2;

        // Path for stroke
        ctx.beginPath();
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = ((timeData[i] - 128) / 128) * sensitivity;
          const y = centerY + v * (h * 0.42);

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }

        // Stroke with glow
        ctx.shadowBlur = 8;
        ctx.shadowColor = colors.glow;
        const strokeGrad = ctx.createLinearGradient(0, 0, width, 0);
        strokeGrad.addColorStop(0, colors.secondary);
        strokeGrad.addColorStop(0.5, colors.primary);
        strokeGrad.addColorStop(1, colors.secondary);
        ctx.strokeStyle = strokeGrad;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Gradient area fill underneath
        ctx.lineTo(width, centerY);
        ctx.lineTo(0, centerY);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
        fillGrad.addColorStop(0, colors.fillTop);
        fillGrad.addColorStop(1, colors.fillBottom);
        ctx.fillStyle = fillGrad;
        ctx.fill();

      } else if (mode === 'spectrum') {
        // Frequency Domain (Spectrum Equalizer Bars)
        const freqData = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(freqData);

        // Number of visible bars (e.g. 40 - 56)
        const numBars = Math.min(48, Math.floor(width / 7));
        const barWidth = Math.max(2, (width / numBars) - 2.5);
        const step = Math.floor((bufferLength * 0.75) / numBars);

        // Ensure peak hold arrays match
        if (peaksRef.current.length !== numBars) {
          peaksRef.current = new Array(numBars).fill(0);
          peakDecayRef.current = new Array(numBars).fill(0);
        }

        let maxFreqVal = 0;
        let sumFreq = 0;

        for (let i = 0; i < numBars; i++) {
          // Average a slice of frequencies for smoother musical response
          let sum = 0;
          for (let j = 0; j < step; j++) {
            sum += freqData[i * step + j] || 0;
          }
          const avg = (sum / step) * sensitivity;
          const normalized = Math.min(255, avg) / 255;
          sumFreq += normalized;
          if (normalized > maxFreqVal) maxFreqVal = normalized;

          const barHeight = Math.max(3, normalized * (h * 0.9));
          const x = i * (barWidth + 2.5) + 1;
          const y = h - barHeight;

          // Peak hold logic
          if (barHeight >= peaksRef.current[i]) {
            peaksRef.current[i] = barHeight;
            peakDecayRef.current[i] = 0;
          } else {
            peakDecayRef.current[i] += 0.45;
            peaksRef.current[i] = Math.max(0, peaksRef.current[i] - peakDecayRef.current[i]);
          }

          // Bar gradient
          const barGrad = ctx.createLinearGradient(0, h, 0, y);
          barGrad.addColorStop(0, colors.secondary);
          barGrad.addColorStop(0.7, colors.primary);
          barGrad.addColorStop(1, '#ffffff');

          ctx.fillStyle = barGrad;
          // Rounded top bar
          const radius = Math.min(barWidth / 2, 2);
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
          ctx.fill();

          // Peak cap dot
          if (peaksRef.current[i] > 4) {
            ctx.fillStyle = colors.peakDot;
            ctx.fillRect(x, h - peaksRef.current[i] - 2, barWidth, 1.5);
          }
        }

        const currentPeakDb = maxFreqVal > 0.001 ? Math.max(-60, 20 * Math.log10(maxFreqVal)) : -60;
        const avgNorm = sumFreq / numBars;
        const currentRmsDb = avgNorm > 0.001 ? Math.max(-60, 20 * Math.log10(avgNorm)) : -60;
        setPeakDb(prev => prev * 0.85 + currentPeakDb * 0.15);
        setRmsDb(prev => prev * 0.85 + currentRmsDb * 0.15);

      } else if (mode === 'aurora') {
        // Neon Aurora (Dual Symmetrical Wave)
        const timeData = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(timeData);

        const centerY = h / 2;
        const sliceWidth = width / bufferLength;

        // Calculate values
        let maxVal = 0;
        for (let i = 0; i < bufferLength; i++) {
          const norm = Math.abs((timeData[i] - 128) / 128);
          if (norm > maxVal) maxVal = norm;
        }
        const currentPeakDb = maxVal > 0.001 ? Math.max(-60, 20 * Math.log10(maxVal)) : -60;
        setPeakDb(prev => prev * 0.85 + currentPeakDb * 0.15);

        // Top and Bottom symmetrical envelope
        ctx.beginPath();
        // Upper wave
        for (let i = 0; i < bufferLength; i++) {
          const v = Math.abs((timeData[i] - 128) / 128) * sensitivity;
          const y = centerY - v * (h * 0.44);
          const x = i * sliceWidth;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        // Lower wave backwards
        for (let i = bufferLength - 1; i >= 0; i--) {
          const v = Math.abs((timeData[i] - 128) / 128) * sensitivity;
          const y = centerY + v * (h * 0.44);
          const x = i * sliceWidth;
          ctx.lineTo(x, y);
        }
        ctx.closePath();

        // Aurora gradient fill
        const auroraGrad = ctx.createLinearGradient(0, 0, width, h);
        auroraGrad.addColorStop(0, colors.fillTop);
        auroraGrad.addColorStop(0.5, colors.primary + '55');
        auroraGrad.addColorStop(1, colors.secondary + '44');
        ctx.fillStyle = auroraGrad;
        ctx.fill();

        // Center reactive beam
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        for (let i = 0; i < bufferLength; i++) {
          const v = ((timeData[i] - 128) / 128) * sensitivity;
          const y = centerY + v * (h * 0.2);
          const x = i * sliceWidth;
          ctx.lineTo(x, y);
        }
        ctx.shadowBlur = 10;
        ctx.shadowColor = colors.glow;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    };

    render();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [analyser, isPlaying, mode, theme, sensitivity]);

  // Format dB for VU Meter display
  const getDbWidth = (db: number) => {
    // Map -60dB to 0dB into 0% to 100%
    const clamped = Math.max(-60, Math.min(0, db));
    return ((clamped + 60) / 60) * 100;
  };

  return (
    <div className={`relative flex flex-col ${className}`}>
      {/* Canvas view */}
      <canvas
        ref={canvasRef}
        style={{ height: `${height}px`, width: '100%' }}
        className="w-full rounded block pointer-events-none"
      />

      {/* Optional VU Meter bar */}
      {showVuMeter && (
        <div className="mt-2 pt-2 border-t border-neutral-800/80 flex items-center justify-between gap-3 text-[10px] font-mono">
          <div className="flex items-center gap-1.5 text-neutral-400">
            <span>PEAK:</span>
            <span className={peakDb > -3 ? 'text-rose-400 font-bold' : peakDb > -12 ? 'text-amber-400' : 'text-cyan-400'}>
              {peakDb.toFixed(1)} dB
            </span>
          </div>

          {/* Graphical VU Level strip */}
          <div className="flex-1 max-w-xs h-1.5 bg-neutral-950 rounded-full overflow-hidden flex border border-neutral-800">
            <div
              className={`h-full transition-all duration-75 rounded-full ${
                peakDb > -3 
                  ? 'bg-rose-500' 
                  : peakDb > -12 
                  ? 'bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-400' 
                  : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
              }`}
              style={{ width: `${getDbWidth(peakDb)}%` }}
            />
          </div>

          <div className="flex items-center gap-1.5 text-neutral-400">
            <span>RMS:</span>
            <span className="text-neutral-300">
              {rmsDb.toFixed(1)} dB
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
