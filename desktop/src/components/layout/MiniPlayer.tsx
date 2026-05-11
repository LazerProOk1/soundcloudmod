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

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden select-none bg-[#0c0c0e]"
      style={{ isolation: 'isolate' }}
    >
      {/* Thin drag strip at top — only the label area is the drag target, NOT the exit button */}
      <div className="h-6 flex items-center justify-between px-2 shrink-0 border-b border-white/[0.04]">
        <div data-tauri-drag-region className="flex-1 h-full flex items-center cursor-move">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/20 pointer-events-none">
            Mini Player
          </span>
        </div>
        {/* Exit button is OUTSIDE the drag region so clicks register correctly */}
        <button
          type="button"
          title="Expand to full player"
          onClick={() => void exit()}
          className="w-5 h-5 rounded flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.08] transition-all cursor-pointer"
        >
          <PictureInPicture2 size={10} />
        </button>
      </div>

      {/* Player row — drag only on artwork + text, NOT on controls */}
      <div className="flex-1 flex items-center gap-2.5 px-3 min-w-0">
        {/* Artwork — draggable dead zone */}
        <div
          data-tauri-drag-region
          className="w-10 h-10 rounded-[8px] shrink-0 overflow-hidden bg-white/[0.04] shadow-lg ring-1 ring-white/[0.06] cursor-move"
        >
          {artwork ? (
            <img src={artwork} alt="" className="w-full h-full object-cover pointer-events-none" />
          ) : (
            <div className="w-full h-full bg-white/[0.04]" />
          )}
        </div>

        {/* Track info — draggable dead zone */}
        <div data-tauri-drag-region className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 cursor-move">
          {currentTrack ? (
            <>
              <ScrollingText
                text={currentTrack.title}
                className="text-[11px] font-semibold text-white/88 leading-tight pointer-events-none"
              />
              <ScrollingText
                text={currentTrack.user.username}
                className="text-[10px] text-white/35 leading-tight pointer-events-none"
              />
            </>
          ) : (
            <span className="text-[11px] text-white/20 pointer-events-none">Not playing</span>
          )}
        </div>

        {/* Controls — NO drag region, clicks must work */}
        <div className="flex items-center gap-0 shrink-0">
          <button
            type="button"
            onClick={handlePrev}
            className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors cursor-pointer rounded-full hover:bg-white/[0.04]"
          >
            {skipBack20}
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center text-black hover:bg-white hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer mx-0.5"
          >
            {isPlaying ? pauseBlack20 : playBlack20}
          </button>

          <button
            type="button"
            onClick={next}
            className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors cursor-pointer rounded-full hover:bg-white/[0.04]"
          >
            {skipForward20}
          </button>
        </div>
      </div>
    </div>
  );
});
