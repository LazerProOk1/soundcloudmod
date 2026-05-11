import React, { useEffect, useRef, useState } from 'react';
import { handlePrev } from '../../lib/audio';
import { art } from '../../lib/formatters';
import {
  pauseBlack20,
  playBlack20,
  skipBack20,
  skipForward20,
} from '../../lib/icons';
import { PictureInPicture2 } from '../../lib/icons';
import { usePlayerStore } from '../../stores/player';
import { useMiniPlayerStore } from '../../stores/mini-player';

/* ── Scrolling text when title overflows ─────────────────────── */

const ScrollingText = React.memo(({ text, className = '' }: { text: string; className?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;
    setShouldScroll(inner.scrollWidth > container.clientWidth + 2);
  }, [text]);

  return (
    <div ref={containerRef} className={`overflow-hidden ${className}`}>
      <span
        ref={innerRef}
        className={`whitespace-nowrap inline-block ${shouldScroll ? 'animate-marquee' : ''}`}
        style={shouldScroll ? { paddingRight: '3rem' } : undefined}
      >
        {text}
        {shouldScroll && <span aria-hidden="true" style={{ paddingLeft: '3rem' }}>{text}</span>}
      </span>
    </div>
  );
});

/* ── MiniPlayer ──────────────────────────────────────────────── */

export const MiniPlayer = React.memo(() => {
  const { currentTrack, isPlaying, togglePlay, next } = usePlayerStore((s) => ({
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    togglePlay: s.togglePlay,
    next: s.next,
  }));
  const exit = useMiniPlayerStore((s) => s.exit);
  const artwork = art(currentTrack?.artwork_url, 't200x200');

  // stopPropagation on mousedown prevents Tauri's drag-region from firing for buttons
  const nodrg = (e: React.MouseEvent) => e.stopPropagation();

  return (
    // data-tauri-drag-region on the whole window — any area without a button is draggable
    <div
      data-tauri-drag-region
      className="h-screen w-screen flex flex-col overflow-hidden select-none"
      style={{ background: '#141416', isolation: 'isolate' }}
    >
      {/* Top strip */}
      <div className="h-7 flex items-center justify-between px-2.5 shrink-0"
           style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40 pointer-events-none">
          Mini Player
        </span>
        {/* Exit button — stopPropagation so click works, not drag */}
        <button
          type="button"
          title="Развернуть"
          onMouseDown={nodrg}
          onClick={() => void exit()}
          className="w-6 h-6 rounded-md flex items-center justify-center text-white/35 hover:text-white/80 hover:bg-white/[0.08] transition-all cursor-pointer"
        >
          <PictureInPicture2 size={11} />
        </button>
      </div>

      {/* Player row */}
      <div className="flex-1 flex items-center gap-2.5 px-2.5 min-w-0">
        {/* Artwork */}
        <div className="w-10 h-10 rounded-[8px] shrink-0 overflow-hidden shadow-lg pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
          {artwork && (
            <img src={artwork} alt="" className="w-full h-full object-cover" />
          )}
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 pointer-events-none">
          {currentTrack ? (
            <>
              <ScrollingText
                text={currentTrack.title}
                className="text-[11px] font-semibold leading-tight text-white/90"
              />
              <ScrollingText
                text={currentTrack.user.username}
                className="text-[10px] leading-tight text-white/45"
              />
            </>
          ) : (
            <span className="text-[11px] text-white/35">Не играет</span>
          )}
        </div>

        {/* Controls — stopPropagation so clicks work, not drag */}
        <div className="flex items-center gap-0 shrink-0" onMouseDown={nodrg}>
          <button
            type="button"
            onClick={handlePrev}
            className="w-8 h-8 flex items-center justify-center transition-colors cursor-pointer rounded-full"
            style={{ color: 'rgba(255,255,255,0.45)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.90)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
          >
            {skipBack20}
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="w-9 h-9 rounded-full flex items-center justify-center text-black transition-all duration-150 cursor-pointer mx-0.5 hover:scale-105 active:scale-95"
            style={{ background: 'rgba(255,255,255,0.92)' }}
          >
            {isPlaying ? pauseBlack20 : playBlack20}
          </button>

          <button
            type="button"
            onClick={next}
            className="w-8 h-8 flex items-center justify-center transition-colors cursor-pointer rounded-full"
            style={{ color: 'rgba(255,255,255,0.45)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.90)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
          >
            {skipForward20}
          </button>
        </div>
      </div>
    </div>
  );
});
