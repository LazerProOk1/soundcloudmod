/**
 * MiniPlayer — 420×120 px compact floating player.
 * Window is transparent → backdrop-filter is real liquid glass.
 * Windows-style chrome (no ×), like on the right.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { getCurrentTime, getDuration, handlePrev, seek } from '../../lib/audio';
import { art } from '../../lib/formatters';
import { optimisticToggleLike } from '../../lib/likes';
import { invalidateAllLikesCache } from '../../lib/hooks';
import { getArtistDisplay } from '../../lib/track-display';
import { usePlayerStore } from '../../stores/player';
import { useMiniPlayerStore } from '../../stores/mini-player';
import type { Track } from '../../stores/player';

/* ── Error boundary ─────────────────────────────────────────── */
class MiniPlayerBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  constructor(props: { children: React.ReactNode }) { super(props); this.state = { error: false }; }
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return (
      <div data-tauri-drag-region style={{ width:'100vw', height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(255,255,255,0.3)', fontSize:11, fontFamily:'system-ui' }}>
        ошибка
      </div>
    );
    return this.props.children;
  }
}

/* ── Helpers ─────────────────────────────────────────────────── */
function fmt(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/* ── SVG icons ───────────────────────────────────────────────── */
const np: React.SVGProps<SVGSVGElement> = { style: { pointerEvents: 'none' } };
const IconPrev = () => <svg {...np} width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>;
const IconPlay = () => <svg {...np} width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const IconPause = () => <svg {...np} width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
const IconNext = () => <svg {...np} width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z"/></svg>;
const IconHeart = ({ filled }: { filled: boolean }) => (
  <svg {...np} width="13" height="13" viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
    strokeWidth={filled ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
);
const IconExpand = () => (
  <svg {...np} width="9" height="9" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
  </svg>
);

/* ── Like hook ───────────────────────────────────────────────── */
function useLocalLike(track: Track | null) {
  const qc = useQueryClient();
  const [liked, setLiked] = useState<boolean | null>(null);
  const prevUrn = useRef<string | null>(null);
  useEffect(() => {
    if (!track || prevUrn.current === track.urn) return;
    prevUrn.current = track.urn;
    setLiked(null);
  }, [track]);
  const isLiked = liked ?? track?.user_favorite ?? false;
  const toggle = async () => {
    if (!track) return;
    const next = !isLiked;
    setLiked(next);
    optimisticToggleLike(qc, track as Parameters<typeof optimisticToggleLike>[1], next);
    invalidateAllLikesCache();
    try { await api(`/likes/tracks/${encodeURIComponent(track.urn)}`, { method: next ? 'POST' : 'DELETE' }); }
    catch { setLiked(!next); }
  };
  return { isLiked, toggle };
}

/* ── Atoms ───────────────────────────────────────────────────── */
const noSel: React.CSSProperties = { userSelect: 'none', WebkitUserSelect: 'none' };
const noDrag = { WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as unknown as React.CSSProperties;
const btnBase: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  transition: 'transform 0.11s cubic-bezier(0.16,1,0.3,1), background 0.12s ease',
  ...noDrag,
};

/* ── Pearl play button ───────────────────────────────────────── */
const PlayBtn = ({ onClick, playing }: { onClick: () => void; playing: boolean }) => {
  const [p, setP] = useState(false);
  return (
    <button style={{
      ...btnBase, width: 38, height: 38, borderRadius: '50%',
      background: 'linear-gradient(160deg,rgba(255,255,255,0.97) 0%,rgba(205,205,230,0.91) 100%)',
      color: '#16162a', transform: p ? 'scale(0.90)' : 'scale(1)',
      boxShadow: p ? '0 1px 4px rgba(0,0,0,0.35)'
        : `0 1px 0 0 rgba(255,255,255,1) inset,
           0 3px 7px -1px rgba(255,255,255,0.5) inset,
           0 -1px 0 0 rgba(0,0,0,0.24) inset,
           0 0 0 0.5px rgba(255,255,255,0.45),
           0 3px 10px rgba(0,0,0,0.32),
           0 8px 24px rgba(0,0,0,0.25)`,
    }}
      onClick={onClick}
      onMouseDown={() => setP(true)} onMouseUp={() => setP(false)} onMouseLeave={() => setP(false)}
    >
      {playing ? <IconPause /> : <IconPlay />}
    </button>
  );
};

/* ── Ghost button ────────────────────────────────────────────── */
const GhostBtn = ({ onClick, active = false, size = 26, children }: {
  onClick: () => void; active?: boolean; size?: number; children: React.ReactNode;
}) => {
  const [p, setP] = useState(false);
  return (
    <button style={{
      ...btnBase, width: size, height: size, borderRadius: '50%',
      color: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.55)',
      background: active ? 'color-mix(in srgb,var(--color-accent) 16%,transparent)' : 'transparent',
      boxShadow: active ? '0 0 8px var(--color-accent-glow,rgba(255,85,0,0.25))' : 'none',
      transform: p ? 'scale(0.84)' : 'scale(1)',
    }}
      onClick={onClick}
      onMouseDown={() => setP(true)} onMouseUp={() => setP(false)} onMouseLeave={() => setP(false)}
    >
      {children}
    </button>
  );
};

/* ── Windows-style chrome button (no close) ──────────────────── */
const WinBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => {
  const [hov, setHov] = useState(false);
  return (
    <button style={{
      ...btnBase, width: 28, height: 18, borderRadius: 3,
      color: 'rgba(255,255,255,0.40)',
      background: hov ? 'rgba(255,255,255,0.09)' : 'transparent',
      fontSize: 12, fontWeight: 400, lineHeight: 1,
    }}
      onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
    >
      {children}
    </button>
  );
};

/* ── Main ────────────────────────────────────────────────────── */
function MiniPlayerInner() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying    = usePlayerStore((s) => s.isPlaying);
  const togglePlay   = usePlayerStore((s) => s.togglePlay);
  const nextTrack    = usePlayerStore((s) => s.next);
  const exit         = useMiniPlayerStore((s) => s.exit);
  const { isLiked, toggle: toggleLike } = useLocalLike(currentTrack);

  const fillRef  = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const curRef   = useRef<HTMLSpanElement>(null);
  const remRef   = useRef<HTMLSpanElement>(null);

  const cover = currentTrack ? art(currentTrack.artwork_url, 't500x500') : null;

  /* RAF progress — GPU-only transforms (scaleX / translateX), zero layout writes */
  useEffect(() => {
    let raf: number;
    let trackW = 0;
    // Read track width once before the loop; ResizeObserver keeps it fresh
    const ro = new ResizeObserver(([e]) => { trackW = e.contentRect.width; });
    if (trackRef.current) { ro.observe(trackRef.current); trackW = trackRef.current.offsetWidth; }

    const tick = () => {
      const cur = getCurrentTime(), dur = getDuration();
      const pct = dur > 0 ? Math.min(1, cur / dur) : 0;
      // scaleX on fill: no width mutation → compositor-only, no layout
      if (fillRef.current)  fillRef.current.style.transform = `scaleX(${pct})`;
      // translateX in px: no left/right mutation → compositor-only
      if (thumbRef.current) thumbRef.current.style.transform =
        `translateY(-50%) translateX(${pct * trackW - 4}px)`;
      if (curRef.current)   curRef.current.textContent  = fmt(cur);
      if (remRef.current)   remRef.current.textContent  = `-${fmt(Math.max(0, dur - cur))}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  /* Drag-to-seek */
  const seekX = useCallback((clientX: number) => {
    const el = trackRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const dur = getDuration(); if (dur > 0) seek(pct * dur);
  }, []);

  const onBarDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); seekX(e.clientX);
    const mv = (ev: MouseEvent) => seekX(ev.clientX);
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  }, [seekX]);

  return (
    <div
      data-tauri-drag-region
      style={{
        width: '100vw', height: '100vh',
        display: 'flex',
        /* ── Floating glass panel ─────────────────────────────────────────────
         * The window is TRANSPARENT — this div IS the visible "window".
         * 40px radius creates a smooth pill that hides DWM's own 8px rounding
         * deep inside our transparent zone → no visible corner conflict.        */
        background: 'rgb(18, 18, 24)',
        borderRadius: 8,
        overflow: 'hidden',
        transform: 'translateZ(0)',
        boxShadow: `
          0 1px 0 0 rgba(255,255,255,0.10) inset,
          0 -1px 0 0 rgba(0,0,0,0.60) inset,
          0 0 0 0.5px rgba(255,255,255,0.07) inset
        `,
        fontFamily: 'Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
        WebkitFontSmoothing: 'antialiased',
        cursor: 'grab',
        ...noSel,
        /* Явный drag на всём корневом div — Tauri читает этот vendor-стиль */
        ...({ WebkitAppRegion: 'drag', appRegion: 'drag' } as React.CSSProperties),
      }}
    >

      {/* ── Artwork panel ──────────────────────────────────── */}
      <div data-tauri-drag-region style={{ width: 120, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
        {/* Frosted separator on right edge */}
        <div aria-hidden style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 1,
          background: 'linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04) 50%,rgba(0,0,0,0.15))',
          zIndex: 2, pointerEvents: 'none',
        }} />
        {/* Artwork */}
        <div style={{
          position: 'absolute', inset: 10, borderRadius: 14, overflow: 'hidden',
          boxShadow: `
            0 1px 0 0 rgba(255,255,255,0.18) inset,
            0 -1px 0 0 rgba(0,0,0,0.40) inset,
            0 0 0 0.5px rgba(255,255,255,0.09),
            0 4px 16px rgba(0,0,0,0.45)
          `,
          background: 'rgba(255,255,255,0.06)',
        }}>
          {cover && <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>
      </div>

      {/* ── Content panel ──────────────────────────────────── */}
      <div data-tauri-drag-region style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: '9px 8px 9px 10px', minWidth: 0, position: 'relative', zIndex: 2,
      }}>
        {/* Row 1: title + Windows chrome (− ⤢ only) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <div data-tauri-drag-region style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12.5, fontWeight: 700, color: 'rgba(255,255,255,0.93)',
              letterSpacing: '-0.02em', lineHeight: 1.25,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {currentTrack?.title ?? 'Не играет'}
            </div>
            <div style={{
              fontSize: 10.5, color: 'rgba(255,255,255,0.38)', marginTop: 1,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {currentTrack ? getArtistDisplay(currentTrack).primary : ''}
            </div>
          </div>

          {/* Exit mini mode */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, ...noDrag }}>
            <WinBtn onClick={() => void exit()}>
              <IconExpand />
            </WinBtn>
          </div>
        </div>

        {/* Row 2: progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '6px 0 5px', ...noDrag }}>
          <span ref={curRef} style={{
            fontSize: 9, color: 'rgba(255,255,255,0.28)',
            fontVariantNumeric: 'tabular-nums', minWidth: 24, textAlign: 'right',
          }}>0:00</span>

          <div ref={trackRef} onMouseDown={onBarDown} style={{
            flex: 1, height: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', position: 'relative',
          }}>
            {/* Rail */}
            <div style={{
              position: 'absolute', left: 0, right: 0, height: 2.5,
              background: 'rgba(255,255,255,0.12)', borderRadius: 2,
              overflow: 'hidden',
            }}>
              {/* Fill: scaleX from left — GPU compositor only, never triggers layout */}
              <div ref={fillRef} style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%',
                background: 'rgba(255,255,255,0.82)',
                borderRadius: 2,
                transform: 'scaleX(0)',
                transformOrigin: 'left center',
                willChange: 'transform',
              }} />
            </div>
            {/* Thumb: translateX in px — GPU compositor only */}
            <div ref={thumbRef} style={{
              position: 'absolute', top: '50%', left: 0,
              transform: 'translateY(-50%) translateX(-4px)',
              width: 8, height: 8, borderRadius: '50%',
              background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
              pointerEvents: 'none',
              willChange: 'transform',
            }} />
          </div>

          <span ref={remRef} style={{
            fontSize: 9, color: 'rgba(255,255,255,0.28)',
            fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'left',
          }}>-0:00</span>
        </div>

        {/* Row 3: controls — prev/play/next centre, like right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...noDrag }}>
          {/* Left spacer (mirrors like on right) */}
          <div style={{ width: 26 }} />

          {/* Centre: prev · play · next */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <GhostBtn onClick={handlePrev} size={28}><IconPrev /></GhostBtn>
            <PlayBtn onClick={togglePlay} playing={isPlaying} />
            <GhostBtn onClick={nextTrack} size={28}><IconNext /></GhostBtn>
          </div>

          {/* Right: like */}
          <GhostBtn onClick={() => void toggleLike()} active={isLiked} size={26}>
            <IconHeart filled={isLiked} />
          </GhostBtn>
        </div>
      </div>
    </div>
  );
}

export const MiniPlayer = () => (
  <MiniPlayerBoundary>
    <MiniPlayerInner />
  </MiniPlayerBoundary>
);
