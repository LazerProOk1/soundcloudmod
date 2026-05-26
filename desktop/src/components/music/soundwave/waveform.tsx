import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { getCurrentTime, getDuration, seek, subscribe } from '../../../lib/audio';
import { useTrackWaveform } from '../../../lib/waveform';
import type { Track } from '../../../stores/player';

/** Fewer bars = wider, more organic (not a barcode). */
const BAR_COUNT = 80;

/** Downsample SC waveform samples into BAR_COUNT averaged bars (0..1). */
function downsample(samples: number[], height: number, count: number): number[] {
  if (!samples.length) return new Array(count).fill(0.35);
  const bucketSize = samples.length / count;
  const raw = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < samples.length; j++) {
      sum += samples[j];
      n++;
    }
    raw[i] = n > 0 ? sum / n / height : 0.35;
  }
  // Stretch dynamic range so even uniform tracks show contrast between bars
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  const span = hi - lo;
  return raw.map((v) => {
    const norm = span > 0.02 ? (v - lo) / span : v;
    // Power curve: lifts quiet bars, keeps loud bars tall
    const curved = norm ** 0.65;
    return 0.1 + curved * 0.88;
  });
}

/** Decorative fallback — organic sine pattern while loading. */
const FALLBACK_BARS = (() => {
  const arr = new Array<number>(BAR_COUNT);
  for (let i = 0; i < BAR_COUNT; i++) {
    const x = i / BAR_COUNT;
    const base = 0.35 + 0.28 * Math.sin(x * Math.PI * 2);
    const detail = 0.18 * Math.sin(x * Math.PI * 7 + 1.3);
    arr[i] = Math.max(0.22, Math.min(0.95, base + detail));
  }
  return arr;
})();

interface Props {
  track: Track | null;
  isCurrent: boolean;
}

/**
 * Progress-bearing waveform with drag-to-seek.
 *
 * Two stacked bar layers (muted + accent), accent clipped by `--sw-progress`.
 * Audio position is updated via DOM refs — zero React re-renders during playback.
 * Drag state is tracked via `useRef` — no React state during mousemove.
 *
 * 120fps rule: only `clip-path` and `left` change at runtime (GPU compositor).
 */
export const LiveWaveform = React.memo(
  function LiveWaveform({ track, isCurrent }: Props) {
    const { data: samples, isLoading } = useTrackWaveform(track);

    const bars = useMemo(() => {
      if (!samples) return FALLBACK_BARS;
      return downsample(samples.values, samples.height, BAR_COUNT);
    }, [samples]);

    const rootRef = useRef<HTMLDivElement>(null);
    const hintRef = useRef<HTMLDivElement>(null);
    /** true while the user is dragging — suppresses the rAF progress updates */
    const isDraggingRef = useRef(false);

    /* ── Progress sync (rAF-free, event-driven) ──────────────────── */
    useEffect(() => {
      if (!isCurrent) {
        rootRef.current?.style.setProperty('--sw-progress', '0%');
        if (hintRef.current) hintRef.current.style.left = '0%';
        return;
      }
      const paint = () => {
        if (isDraggingRef.current) return; // don't fight the drag
        const t = getCurrentTime();
        const d = getDuration();
        const pct = d > 0 ? Math.min(100, Math.max(0, (t / d) * 100)) : 0;
        rootRef.current?.style.setProperty('--sw-progress', `${pct}%`);
        if (hintRef.current) hintRef.current.style.left = `${pct}%`;
      };
      paint();
      return subscribe(paint);
    }, [isCurrent]);

    /* ── Shared seek helper ──────────────────────────────────────── */
    const seekFromClientX = useCallback(
      (clientX: number) => {
        if (!isCurrent || !rootRef.current) return;
        const rect = rootRef.current.getBoundingClientRect();
        const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const d = getDuration();
        if (d <= 0) return;
        // Optimistic visual update while dragging
        const pctStr = `${pct * 100}%`;
        rootRef.current.style.setProperty('--sw-progress', pctStr);
        if (hintRef.current) hintRef.current.style.left = pctStr;
        seek(pct * d);
      },
      [isCurrent],
    );

    /* ── Drag-to-seek ────────────────────────────────────────────── */
    const handleMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isCurrent) return;
        e.preventDefault();
        isDraggingRef.current = true;
        seekFromClientX(e.clientX);

        const onMove = (ev: MouseEvent) => {
          if (!isDraggingRef.current) return;
          seekFromClientX(ev.clientX);
        };
        const onUp = () => {
          isDraggingRef.current = false;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      },
      [isCurrent, seekFromClientX],
    );

    return (
      <div
        ref={rootRef}
        className={`sw-bars relative w-full h-[96px] ${
          isCurrent ? 'cursor-col-resize' : 'cursor-default'
        }`}
        onMouseDown={handleMouseDown}
      >
        {/* Muted layer — gooey blobs */}
        <div
          className="sw-layer-muted absolute inset-0 flex items-center gap-[3px]"
          style={{ filter: 'url(#waveform-gooey)' }}
        >
          {bars.map((v, i) => (
            <div key={i} className="sw-bar flex-1" style={{ height: `${v * 100}%` }} />
          ))}
        </div>

        {/* Accent (progress) layer — gooey blobs, clipped by --sw-progress */}
        <div
          className="sw-layer-accent absolute inset-0 flex items-center gap-[3px]"
          style={{ filter: 'url(#waveform-gooey)' }}
        >
          {bars.map((v, i) => (
            <div key={i} className="sw-bar flex-1" style={{ height: `${v * 100}%` }} />
          ))}
        </div>

        {/* Loading shimmer */}
        {isLoading && (
          <div
            className="absolute inset-0 pointer-events-none"
            aria-hidden
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'skeleton-sweep 1.8s ease-in-out infinite',
            }}
          />
        )}

        {/* Playhead cursor */}
        {isCurrent && (
          <div
            ref={hintRef}
            className="absolute top-0 bottom-0 w-[2px] pointer-events-none rounded-full"
            style={{
              left: '0%',
              background:
                'linear-gradient(180deg, rgba(129,140,248,0.95) 0%, rgba(34,211,238,0.80) 100%)',
              boxShadow:
                '0 0 8px rgba(99,102,241,0.55), 0 0 16px rgba(99,102,241,0.30), 0 0 4px rgba(34,211,238,0.30)',
              willChange: 'left',
            }}
          />
        )}
      </div>
    );
  },
  (prev, next) => prev.track?.urn === next.track?.urn && prev.isCurrent === next.isCurrent,
);
