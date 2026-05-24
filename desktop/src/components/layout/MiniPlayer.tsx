/**
 * MiniPlayer — 380×66 px compact floating strip.
 * Layout (single row): [artwork 66×66] [info: title + artist] [controls] [expand]
 * Progress: 2 px accent strip pinned to bottom, no timestamps, no thumb.
 */

import { useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { getCurrentTime, getDuration, handlePrev, seek } from '../../lib/audio';
import { art } from '../../lib/formatters';
import { invalidateAllLikesCache } from '../../lib/hooks';
import { optimisticToggleLike } from '../../lib/likes';
import { getArtistDisplay, getDisplayTitle } from '../../lib/track-display';
import { useMiniPlayerStore } from '../../stores/mini-player';
import type { Track } from '../../stores/player';
import { usePlayerStore } from '../../stores/player';

/* ── Error boundary ─────────────────────────────────────────── */
class MiniPlayerBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: false };
  }
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error)
      return (
        <div
          data-tauri-drag-region
          style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.3)',
            fontSize: 11,
            fontFamily: 'system-ui',
          }}
        >
          ошибка
        </div>
      );
    return this.props.children;
  }
}

/* ── Style atoms ────────────────────────────────────────────── */
const noSel: React.CSSProperties = { userSelect: 'none', WebkitUserSelect: 'none' };
const noDrag = { WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as unknown as React.CSSProperties;
const drag = { WebkitAppRegion: 'drag', appRegion: 'drag' } as unknown as React.CSSProperties;
const np: React.SVGProps<SVGSVGElement> = { style: { pointerEvents: 'none' } };

/* ── SVG icons ──────────────────────────────────────────────── */
const IconPrev = () => (
  <svg {...np} width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
  </svg>
);
const IconPlay = () => (
  <svg {...np} width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconPause = () => (
  <svg {...np} width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
const IconNext = () => (
  <svg {...np} width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" />
  </svg>
);
const IconHeart = ({ filled }: { filled: boolean }) => (
  <svg
    {...np}
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);
const IconExpand = () => (
  <svg
    {...np}
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </svg>
);

/* ── Like logic ─────────────────────────────────────────────── */
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
    try {
      await api(`/likes/tracks/${encodeURIComponent(track.urn)}`, {
        method: next ? 'POST' : 'DELETE',
      });
    } catch {
      setLiked(!next);
    }
  };

  return { isLiked, toggle };
}

/* ── Play button — white pearl circle ──────────────────────── */
const PlayBtn = ({ onClick, playing }: { onClick: () => void; playing: boolean }) => {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      style={{
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        width: 32,
        height: 32,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'linear-gradient(150deg,rgba(255,255,255,0.97) 0%,rgba(215,215,235,0.92) 100%)',
        color: '#18182a',
        transform: pressed ? 'scale(0.87)' : 'scale(1)',
        transition: 'transform 0.10s cubic-bezier(0.16,1,0.3,1)',
        boxShadow: pressed
          ? '0 1px 3px rgba(0,0,0,0.45)'
          : [
              '0 1px 0 0 rgba(255,255,255,1) inset',
              '0 3px 8px -2px rgba(255,255,255,0.50) inset',
              '0 -1px 0 0 rgba(0,0,0,0.18) inset',
              '0 0 0 0.5px rgba(255,255,255,0.45)',
              '0 3px 12px rgba(0,0,0,0.42)',
            ].join(','),
        ...noDrag,
      }}
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
    >
      {playing ? <IconPause /> : <IconPlay />}
    </button>
  );
};

/* ── Ghost control button ───────────────────────────────────── */
const GhostBtn = ({
  onClick,
  active = false,
  size = 26,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  size?: number;
  children: React.ReactNode;
}) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      style={{
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        color: active
          ? 'var(--color-accent,#ff5500)'
          : hovered
            ? 'rgba(255,255,255,0.82)'
            : 'rgba(255,255,255,0.40)',
        background: active
          ? 'color-mix(in srgb,var(--color-accent,#ff5500) 16%,transparent)'
          : hovered
            ? 'rgba(255,255,255,0.06)'
            : 'transparent',
        transform: pressed ? 'scale(0.80)' : 'scale(1)',
        transition: 'transform 0.09s cubic-bezier(0.16,1,0.3,1), color 0.14s, background 0.14s',
        ...noDrag,
      }}
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => { setPressed(false); setHovered(false); }}
      onMouseEnter={() => setHovered(true)}
    >
      {children}
    </button>
  );
};

/* ── Main component ─────────────────────────────────────────── */
function MiniPlayerInner() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextTrack = usePlayerStore((s) => s.next);
  const exit = useMiniPlayerStore((s) => s.exit);
  const { isLiked, toggle: toggleLike } = useLocalLike(currentTrack);

  /* RAF-driven progress refs */
  const fillRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const cover = currentTrack ? art(currentTrack.artwork_url, 't300x300') : null;
  const artistName = currentTrack ? getArtistDisplay(currentTrack).primary : '';
  const title = currentTrack ? getDisplayTitle(currentTrack) : 'Не играет';

  /* ── RAF progress ticker ────────────────────────────────── */
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const cur = getCurrentTime();
      const dur = getDuration();
      const pct = dur > 0 ? Math.min(1, cur / dur) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${pct})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ── Drag-to-seek on progress bar ───────────────────────── */
  const seekToX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const dur = getDuration();
    if (dur > 0) seek(pct * dur);
  }, []);

  const onBarDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      seekToX(e.clientX);
      const mv = (ev: MouseEvent) => seekToX(ev.clientX);
      const up = () => {
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    },
    [seekToX],
  );

  return (
    <div
      data-tauri-drag-region
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        fontFamily:
          'Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
        WebkitFontSmoothing: 'antialiased',
        cursor: 'grab',
        background: 'rgba(13,13,19,0.96)',
        boxShadow: [
          '0 0 0 0.5px rgba(255,255,255,0.09) inset',
          '0 1px 0 rgba(255,255,255,0.07) inset',
        ].join(','),
        transform: 'translateZ(0)',
        ...noSel,
        ...drag,
      }}
    >
      {/* ── Artwork colour glow — full-bleed behind everything ── */}
      {cover && (
        <img
          src={cover}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.12,
            filter: 'blur(28px) saturate(1.8)',
            transform: 'scale(1.2)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}
      {/* Gradient overlay — left side brighter for art, right darker */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg,rgba(10,10,16,0.55) 0%,rgba(10,10,16,0.78) 35%,rgba(10,10,16,0.88) 100%)',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {/* ── Square artwork — left flush, fills full height ──── */}
      <div
        style={{
          width: 66,
          height: 66,
          flexShrink: 0,
          position: 'relative',
          zIndex: 2,
          overflow: 'hidden',
        }}
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.04)' }}
          />
        )}
        {/* Thin right-edge separator */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 1,
            height: '100%',
            background:
              'linear-gradient(180deg,transparent,rgba(255,255,255,0.10) 30%,rgba(255,255,255,0.07) 70%,transparent)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* ── Track info — fills remaining space ──────────────── */}
      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 0 0 12px',
          position: 'relative',
          zIndex: 2,
          gap: 10,
        }}
      >
        {/* Title + artist */}
        <div
          data-tauri-drag-region
          style={{ flex: 1, minWidth: 0 }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.94)',
              letterSpacing: '-0.030em',
              lineHeight: 1.22,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 400,
              color: 'rgba(255,255,255,0.38)',
              letterSpacing: '-0.015em',
              lineHeight: 1.3,
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {artistName}
          </div>
        </div>

        {/* ── Controls row ─────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
            ...noDrag,
          }}
        >
          <GhostBtn onClick={() => void toggleLike()} active={isLiked} size={26}>
            <IconHeart filled={isLiked} />
          </GhostBtn>
          <GhostBtn onClick={handlePrev} size={26}>
            <IconPrev />
          </GhostBtn>
          <PlayBtn onClick={togglePlay} playing={isPlaying} />
          <GhostBtn onClick={nextTrack} size={26}>
            <IconNext />
          </GhostBtn>
        </div>

        {/* ── Expand button ────────────────────────────────── */}
        <button
          type="button"
          onClick={() => void exit()}
          style={{
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            width: 28,
            height: 66,
            flexShrink: 0,
            color: 'rgba(255,255,255,0.22)',
            background: 'rgba(255,255,255,0.03)',
            borderLeft: '1px solid rgba(255,255,255,0.05)',
            transition: 'color 0.14s, background 0.14s',
            ...noDrag,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.65)';
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.22)';
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)';
          }}
        >
          <IconExpand />
        </button>
      </div>

      {/* ── Progress strip — 2 px, absolutely at bottom ─────── */}
      <div
        ref={trackRef}
        onMouseDown={onBarDown}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 18,
          cursor: 'pointer',
          zIndex: 10,
          ...noDrag,
        }}
      >
        {/* Visible rail */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          }}
        >
          <div
            ref={fillRef}
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(90deg,var(--color-accent,#ff5500),color-mix(in srgb,var(--color-accent,#ff5500) 75%,#ff9955))',
              transform: 'scaleX(0)',
              transformOrigin: 'left center',
              willChange: 'transform',
            }}
          />
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
