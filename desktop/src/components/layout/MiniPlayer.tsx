/**
 * MiniPlayer — 420×120 px compact floating player.
 * Window is transparent → the root div IS the visible surface.
 * Design: glassmorphic dark pill with dynamic artwork glow backdrop.
 */

import { useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { getCurrentTime, getDuration, handlePrev, seek } from '../../lib/audio';
import { art } from '../../lib/formatters';
import { invalidateAllLikesCache } from '../../lib/hooks';
import { optimisticToggleLike } from '../../lib/likes';
import { getArtistDisplay } from '../../lib/track-display';
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

/* ── Time formatter ─────────────────────────────────────────── */
function fmt(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/* ── SVG icons (pointer-events: none prevents drag interrupts) ── */
const np: React.SVGProps<SVGSVGElement> = { style: { pointerEvents: 'none' } };

const IconPrev = () => (
  <svg {...np} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
  </svg>
);
const IconPlay = () => (
  <svg {...np} width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconPause = () => (
  <svg {...np} width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
const IconNext = () => (
  <svg {...np} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" />
  </svg>
);
const IconHeart = ({ filled }: { filled: boolean }) => (
  <svg
    {...np}
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);
const IconExpand = () => (
  <svg
    {...np}
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
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

/* ── Shared style atoms ─────────────────────────────────────── */
const noSel: React.CSSProperties = { userSelect: 'none', WebkitUserSelect: 'none' };
const noDrag = {
  WebkitAppRegion: 'no-drag',
  appRegion: 'no-drag',
} as unknown as React.CSSProperties;
const drag = { WebkitAppRegion: 'drag', appRegion: 'drag' } as unknown as React.CSSProperties;

/* ── Play button — pill-shaped pearl ───────────────────────── */
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
        width: 40,
        height: 40,
        borderRadius: '50%',
        flexShrink: 0,
        background: 'linear-gradient(150deg,rgba(255,255,255,0.96) 0%,rgba(210,210,235,0.90) 100%)',
        color: '#17172b',
        transform: pressed ? 'scale(0.88)' : 'scale(1)',
        transition: 'transform 0.12s cubic-bezier(0.16,1,0.3,1), box-shadow 0.12s ease',
        boxShadow: pressed
          ? '0 1px 3px rgba(0,0,0,0.40)'
          : [
              '0 1px 0 0 rgba(255,255,255,1) inset',
              '0 3px 8px -2px rgba(255,255,255,0.55) inset',
              '0 -1px 0 0 rgba(0,0,0,0.22) inset',
              '0 0 0 0.5px rgba(255,255,255,0.5)',
              '0 4px 14px rgba(0,0,0,0.38)',
              '0 10px 28px rgba(0,0,0,0.20)',
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
  size = 28,
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
          ? 'var(--color-accent)'
          : hovered
            ? 'rgba(255,255,255,0.80)'
            : 'rgba(255,255,255,0.45)',
        background: active
          ? 'color-mix(in srgb,var(--color-accent) 18%,transparent)'
          : hovered
            ? 'rgba(255,255,255,0.07)'
            : 'transparent',
        boxShadow: active ? '0 0 10px var(--color-accent-glow,rgba(255,85,0,0.30))' : 'none',
        transform: pressed ? 'scale(0.82)' : 'scale(1)',
        transition:
          'transform 0.10s cubic-bezier(0.16,1,0.3,1), color 0.15s ease, background 0.15s ease',
        ...noDrag,
      }}
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => {
        setPressed(false);
        setHovered(false);
      }}
      onMouseEnter={() => setHovered(true)}
    >
      {children}
    </button>
  );
};

/* ── Expand/restore chrome button ───────────────────────────── */
const ChromeBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => {
  const [hov, setHov] = useState(false);
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
        width: 22,
        height: 22,
        borderRadius: 6,
        color: hov ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.30)',
        background: hov ? 'rgba(255,255,255,0.08)' : 'transparent',
        transition: 'color 0.12s ease, background 0.12s ease',
        ...noDrag,
      }}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
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

  /* DOM refs for RAF-driven progress (zero layout writes in hot path) */
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);
  const remRef = useRef<HTMLSpanElement>(null);

  /* Artwork URL (high-res for blur backdrop too) */
  const cover = currentTrack ? art(currentTrack.artwork_url, 't500x500') : null;

  const artistName = currentTrack ? getArtistDisplay(currentTrack).primary : '';
  const title = currentTrack?.title ?? 'Не играет';

  /* ── RAF progress ticker ────────────────────────────────── */
  useEffect(() => {
    let raf: number;
    let trackW = 0;

    const ro = new ResizeObserver(([e]) => {
      trackW = e.contentRect.width;
    });
    if (trackRef.current) {
      ro.observe(trackRef.current);
      trackW = trackRef.current.offsetWidth;
    }

    const tick = () => {
      const cur = getCurrentTime();
      const dur = getDuration();
      const pct = dur > 0 ? Math.min(1, cur / dur) : 0;

      if (fillRef.current) fillRef.current.style.transform = `scaleX(${pct})`;
      if (thumbRef.current)
        thumbRef.current.style.transform = `translateY(-50%) translateX(${pct * trackW - 5}px)`;
      if (curRef.current) curRef.current.textContent = fmt(cur);
      if (remRef.current) remRef.current.textContent = `-${fmt(Math.max(0, dur - cur))}`;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  /* ── Drag-to-seek ───────────────────────────────────────── */
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
        borderRadius: 8,
        fontFamily: 'Inter,-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
        WebkitFontSmoothing: 'antialiased',
        cursor: 'grab',
        background: 'rgb(14, 14, 20)',
        boxShadow: [
          '0 0 0 0.5px rgba(255,255,255,0.08) inset',
          '0 1px 0 rgba(255,255,255,0.09) inset',
          '0 -1px 0 rgba(0,0,0,0.65) inset',
        ].join(','),
        transform: 'translateZ(0)',
        ...noSel,
        ...drag,
      }}
    >
      {/* ── Dynamic artwork glow backdrop ───────────────────── */}
      {cover && (
        <>
          {/* Blurred artwork fills entire background softly */}
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
              opacity: 0.1,
              filter: 'blur(24px) saturate(1.6)',
              transform: 'scale(1.15)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          {/* Dark overlay so text stays readable */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg,rgba(12,12,18,0.82) 0%,rgba(12,12,18,0.68) 100%)',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          />
        </>
      )}

      {/* ── Artwork panel ───────────────────────────────────── */}
      <div
        data-tauri-drag-region
        style={{
          width: 112,
          flexShrink: 0,
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Vertical separator */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 12,
            bottom: 12,
            right: 0,
            width: 1,
            background:
              'linear-gradient(180deg,transparent,rgba(255,255,255,0.10) 30%,rgba(255,255,255,0.07) 70%,transparent)',
            zIndex: 3,
            pointerEvents: 'none',
          }}
        />
        {/* Cover art */}
        <div
          style={{
            width: 82,
            height: 82,
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: [
              '0 0 0 0.5px rgba(255,255,255,0.10)',
              '0 1px 0 rgba(255,255,255,0.15) inset',
              '0 6px 20px rgba(0,0,0,0.55)',
              '0 2px 8px rgba(0,0,0,0.35)',
            ].join(','),
            background: 'rgba(255,255,255,0.05)',
            position: 'relative',
          }}
        >
          {cover && (
            <img
              src={cover}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
          {/* Subtle inner sheen */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 12,
              background: 'linear-gradient(135deg,rgba(255,255,255,0.12) 0%,transparent 50%)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {/* ── Content panel ───────────────────────────────────── */}
      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '10px 10px 10px 8px',
          position: 'relative',
          zIndex: 2,
          gap: 0,
        }}
      >
        {/* ── Row 1: Track info + expand button ─────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
          <div data-tauri-drag-region style={{ flex: 1, minWidth: 0 }}>
            {/* Title */}
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.95)',
                letterSpacing: '-0.025em',
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </div>
            {/* Artist */}
            <div
              style={{
                fontSize: 10.5,
                color: 'rgba(255,255,255,0.40)',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: '-0.01em',
              }}
            >
              {artistName}
            </div>
          </div>

          {/* Expand / exit mini mode */}
          <ChromeBtn onClick={() => void exit()}>
            <IconExpand />
          </ChromeBtn>
        </div>

        {/* ── Row 2: Progress bar ────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 7,
            ...noDrag,
          }}
        >
          <span
            ref={curRef}
            style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.30)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 26,
              textAlign: 'right',
              letterSpacing: '0.01em',
            }}
          >
            0:00
          </span>

          {/* Seekable track */}
          <div
            ref={trackRef}
            onMouseDown={onBarDown}
            style={{
              flex: 1,
              height: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
            }}
          >
            {/* Rail */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: 2.5,
                background: 'rgba(255,255,255,0.10)',
                borderRadius: 99,
                overflow: 'hidden',
              }}
            >
              {/* Accent fill — scaleX GPU-only */}
              <div
                ref={fillRef}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: '100%',
                  background:
                    'linear-gradient(90deg,var(--color-accent,#ff5500),color-mix(in srgb,var(--color-accent,#ff5500) 80%,#ff9955))',
                  borderRadius: 99,
                  transform: 'scaleX(0)',
                  transformOrigin: 'left center',
                  willChange: 'transform',
                }}
              />
            </div>
            {/* Thumb — translateX GPU-only */}
            <div
              ref={thumbRef}
              style={{
                position: 'absolute',
                top: '50%',
                left: 0,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'white',
                boxShadow: '0 1px 5px rgba(0,0,0,0.55)',
                transform: 'translateY(-50%) translateX(-5px)',
                pointerEvents: 'none',
                willChange: 'transform',
              }}
            />
          </div>

          <span
            ref={remRef}
            style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.30)',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 30,
              textAlign: 'left',
              letterSpacing: '0.01em',
            }}
          >
            -0:00
          </span>
        </div>

        {/* ── Row 3: Controls ────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            ...noDrag,
          }}
        >
          {/* Like — leftmost */}
          <GhostBtn onClick={() => void toggleLike()} active={isLiked} size={26}>
            <IconHeart filled={isLiked} />
          </GhostBtn>

          {/* Centre: Prev · Play · Next */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <GhostBtn onClick={handlePrev} size={28}>
              <IconPrev />
            </GhostBtn>
            <PlayBtn onClick={togglePlay} playing={isPlaying} />
            <GhostBtn onClick={nextTrack} size={28}>
              <IconNext />
            </GhostBtn>
          </div>

          {/* Right spacer mirrors like on left */}
          <div style={{ width: 26 }} />
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
