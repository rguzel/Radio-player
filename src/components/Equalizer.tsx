import { useEffect, useRef } from 'react';

interface EqualizerProps {
  /** Live frequency data; when null the bars are animated without real data. */
  analyser: AnalyserNode | null;
  /** Bars rise while true and settle to the floor while false. */
  active: boolean;
  bars?: number;
  className?: string;
}

const FLOOR = 0.04;

/**
 * Graphic equalizer drawn on a canvas. Uses real frequency data when the
 * stream allows it (see useRadioPlayer), otherwise a smooth simulated motion.
 */
export function Equalizer({ analyser, active, bars = 28, className = '' }: EqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<Float32Array>(new Float32Array(bars));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (levelsRef.current.length !== bars) levelsRef.current = new Float32Array(bars);
    const levels = levelsRef.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const phases = Array.from({ length: bars }, (_, i) => i * 1.7 + Math.random());
    const speeds = Array.from({ length: bars }, () => 0.8 + Math.random() * 0.9);
    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue('--color-accent').trim() || '#f59e0b';
    let frame = 0;
    let retry: number | undefined;

    // Log-spaced frequency ranges per bar, so bass doesn't take up half the
    // display. Skips the very top bins, which compressed streams leave empty.
    const ranges = bins
      ? Array.from({ length: bars }, (_, i) => {
          const maxBin = Math.floor(bins.length * 0.75);
          const lo = Math.floor(Math.pow(maxBin, i / bars));
          const hi = Math.max(lo + 1, Math.floor(Math.pow(maxBin, (i + 1) / bars)));
          return [lo, hi] as const;
        })
      : [];

    const targetLevels = (time: number): number[] => {
      if (!active || reduceMotion) return Array(bars).fill(active ? 0.3 : FLOOR);
      if (analyser && bins) {
        analyser.getByteFrequencyData(bins);
        return ranges.map(([lo, hi]) => {
          let sum = 0;
          for (let b = lo; b < hi; b++) sum += bins[b];
          return Math.max(FLOOR, (sum / (hi - lo) / 255) ** 1.4);
        });
      }
      // Simulated: layered sines, a little stronger at the low end.
      return phases.map((phase, i) => {
        const t = time / 1000;
        const wave = Math.sin(t * 3.1 * speeds[i] + phase) * 0.5 + Math.sin(t * 7.3 * speeds[i] + phase * 2) * 0.25;
        const tilt = 0.75 - (i / bars) * 0.3;
        return Math.max(FLOOR, Math.min(1, tilt * (0.55 + wave * 0.6)));
      });
    };

    const draw = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      // Hidden (e.g. the side panel on small screens): nothing to draw. Check
      // again shortly in case it becomes visible while playing.
      if (width === 0 || height === 0) {
        if (active && !reduceMotion) retry = window.setTimeout(() => { frame = requestAnimationFrame(draw); }, 500);
        return;
      }
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const targets = targetLevels(time);
      let moving = false;
      const gap = Math.max(2, width / bars / 4);
      const barWidth = Math.max(1, (width - gap * (bars - 1)) / bars);
      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#ea580c');
      gradient.addColorStop(1, accent);
      ctx.fillStyle = gradient;

      for (let i = 0; i < bars; i++) {
        // Fast attack, slower release, like a hardware meter.
        const rate = targets[i] > levels[i] ? 0.45 : 0.12;
        levels[i] += (targets[i] - levels[i]) * rate;
        if (Math.abs(targets[i] - levels[i]) > 0.002) moving = true;
        const barHeight = Math.max(2, levels[i] * height);
        ctx.beginPath();
        ctx.roundRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight, Math.min(3, barWidth / 2));
        ctx.fill();
      }

      // Keep animating while playing; when stopped, run until the bars settle.
      if (active && !reduceMotion) frame = requestAnimationFrame(draw);
      else if (moving) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(retry);
    };
  }, [analyser, active, bars]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={analyser ? 'Live audio spectrum' : 'Equalizer animation'}
      data-mode={analyser ? 'spectrum' : 'simulated'}
      className={`block ${className}`}
    />
  );
}
