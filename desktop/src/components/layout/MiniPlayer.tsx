/**
 * MiniPlayer — ультра-современное плавающее окно плеера.
 *
 * Жидкое стекло (backdrop-filter: blur(50px) saturate(220%)), круглая
 * обложка, глянцевый заголовок с marquee, только Play/Pause + Like.
 * Никакого SoundWave внутри — только чистый минималистичный контроль.
 *
 * Рендерится в отдельном Tauri-окне (isMini=true в App.tsx).
 * data-tauri-drag-region — вся «нейтральная» площадь тянет окно.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { handlePrev } from '../../lib/audio';
import { art } from '../../lib/formatters';
import { optimisticToggleLike } from '../../lib/likes';
import { invalidateAllLikesCache } from '../../lib/hooks';
import { usePlayerStore } from '../../stores/player';
import { useMiniPlayerStore } from '../../stores/mini-player';
import type { Track } from '../../stores/player';

/* ── Error boundary ─────────────────────────────────────────── */
class MiniPlayerBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: false };
  }
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) {
      return (
        <div
          data-tauri-drag-region
          style={{
            width: '100vw', height: '100vh',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(8,8,12,0.96)',
            color: 'rgba(255,255,255,0.35)',
            fontSize: 11,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          ошибка — перезапусти
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── SVG icons (pointer-events:none so Tauri drag works) ─────── */
const noPtr: React.SVGProps<SVGSVGElement> = { style: { pointerEvents: 'none' } };

const IconPrev = () => (
  <svg {...noPtr} width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
  </svg>
);
const IconPlay = () => (
  <svg {...noPtr} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z"/>
  </svg>
);
const IconPause = () => (
  <svg {...noPtr} width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
  </svg>
);
const IconNext = () => (
  <svg {...noPtr} width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/>
  </svg>
);
const IconExpand = () => (
  <svg {...noPtr} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
  </svg>
);
const IconHeart = ({ filled }: { filled: boolean }) => (
  <svg
    {...noPtr}
    width="13" height="13" viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
);

/* ── Like hook (local optimistic) ────────────────────────────── */
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
    if (track) optimisticToggleLike(qc, track as Parameters<typeof optimisticToggleLike>[1], next);
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

/* ── Styles ───────────────────────────────────────────────────── */
const noSelect: React.CSSProperties = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

/** Жидкое стекло — не анимируем backdrop-filter, он статичный */
const rootStyle: React.CSSProperties = {
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(8, 8, 12, 0.85)',
  backdropFilter: 'blur(50px) saturate(220%)',
  WebkitBackdropFilter: 'blur(50px) saturate(220%)',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  WebkitFontSmoothing: 'antialiased',
  ...noSelect,
};

/** Кнопка без drag — интерактивна */
const noDragBtn = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  /* WebkitAppRegion injected below via spread to avoid TS error */
  transition: 'opacity 0.15s ease, transform 0.15s ease',
  color: 'rgba(255,255,255,0.55)',
  padding: 0,
  ...(({ WebkitAppRegion: 'no-drag', appRegion: 'no-drag' }) as Record<string, unknown>),
} as React.CSSProperties;

/* ── Mercury control button ───────────────────────────────────── */
const MercuryBtn = ({
  onClick,
  accent = false,
  size = 32,
  children,
}: {
  onClick: () => void;
  accent?: boolean;
  size?: number;
  children: React.ReactNode;
}) => {
  const [pressed, setPressed] = useState(false);

  return (
    <button
      style={{
        ...noDragBtn,
        width: size,
        height: size,
        borderRadius: '50%',
        background: accent
          ? 'linear-gradient(165deg, rgba(255,255,255,0.96) 0%, rgba(220,220,238,0.91) 100%)'
          : 'rgba(255,255,255,0.08)',
        boxShadow: accent
          ? `0 1px 0 0 rgba(255,255,255,1.0) inset,
             0 -1px 0 0 rgba(0,0,0,0.22) inset,
             1px 0 0 0 rgba(255,255,255,0.80) inset,
             -1px 0 0 0 rgba(0,0,0,0.10) inset,
             0 0 0 1px rgba(255,255,255,0.16),
             0 4px 16px rgba(0,0,0,0.45),
             0 2px 6px rgba(0,0,0,0.28)`
          : `0 1px 0 0 rgba(255,255,255,0.18) inset,
             0 -1px 0 0 rgba(0,0,0,0.30) inset,
             0 0 0 0.5px rgba(255,255,255,0.07),
             0 2px 8px rgba(0,0,0,0.30)`,
        color: accent ? '#111' : 'rgba(255,255,255,0.65)',
        transform: pressed ? 'scale(0.93)' : 'scale(1)',
        transition: 'transform 0.12s cubic-bezier(0.16,1,0.3,1)',
      }}
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
    >
      {children}
    </button>
  );
};

/* ── Small ghost button (prev / next / like) ─────────────────── */
const GhostBtn = ({
  onClick,
  active = false,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) => {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      style={{
        ...noDragBtn,
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: active ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.45)',
        transform: pressed ? 'scale(0.88)' : 'scale(1)',
        transition: 'transform 0.12s ease',
      }}
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
    >
      {children}
    </button>
  );
};

/* ── Marquee title ───────────────────────────────────────────── */
const MarqueeTitle = ({ text, maxWidth = 120 }: { text: string; maxWidth?: number }) => {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [shouldMarquee, setShouldMarquee] = useState(false);

  useEffect(() => {
    if (!measureRef.current) return;
    setShouldMarquee(measureRef.current.scrollWidth > maxWidth);
  }, [text, maxWidth]);

  return (
    <div
      style={{
        width: maxWidth,
        overflow: 'hidden',
        position: 'relative',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {/* Invisible measure span */}
      <span
        ref={measureRef}
        style={{
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'nowrap',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {text}
      </span>

      {shouldMarquee ? (
        <div style={{ display: 'flex', gap: 32, width: 'max-content', animation: 'marquee 8s linear infinite' }}>
          <span style={{ whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>
            {text}
          </span>
          <span style={{ whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>
            {text}
          </span>
        </div>
      ) : (
        <span style={{ whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)', display: 'block' }}>
          {text}
        </span>
      )}
    </div>
  );
};

/* ── Component ───────────────────────────────────────────────── */
function MiniPlayerInner() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying    = usePlayerStore((s) => s.isPlaying);
  const togglePlay   = usePlayerStore((s) => s.togglePlay);
  const next         = usePlayerStore((s) => s.next);
  const exit         = useMiniPlayerStore((s) => s.exit);
  const { isLiked, toggle: toggleLike } = useLocalLike(currentTrack);

  const cover = currentTrack ? art(currentTrack.artwork_url, 't200x200') : null;

  return (
    <div data-tauri-drag-region style={rootStyle}>

      {/* Top bar: branding + expand */}
      <div
        data-tauri-drag-region
        style={{
          height: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <span
          data-tauri-drag-region
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.20em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
            background: 'linear-gradient(90deg, rgba(255,120,40,0.90) 0%, rgba(255,255,255,0.55) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          SoundCloud
        </span>
        <button style={{ ...noDragBtn, width: 22, height: 22, borderRadius: 6, color: 'rgba(255,255,255,0.35)' }} onClick={() => void exit()} title="Развернуть">
          <IconExpand />
        </button>
      </div>

      {/* Player body */}
      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 12px',
          minWidth: 0,
        }}
      >
        {/* Circular artwork */}
        <div
          data-tauri-drag-region
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            background: 'rgba(255,255,255,0.06)',
            boxShadow: `
              0 1px 0 0 rgba(255,255,255,0.20) inset,
              0 -1px 0 0 rgba(0,0,0,0.48) inset,
              0 4px 16px rgba(0,0,0,0.55),
              0 0 0 1.5px rgba(255,255,255,0.08)
            `,
            pointerEvents: 'none',
            flexBasis: 44,
          }}
        >
          {cover && (
            <img
              src={cover}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
        </div>

        {/* Title + artist */}
        <div data-tauri-drag-region style={{ flex: 1, minWidth: 0, pointerEvents: 'none' } as React.CSSProperties}>
          {currentTrack ? (
            <>
              <MarqueeTitle text={currentTrack.title} maxWidth={110} />
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                {currentTrack.user?.username ?? ''}
              </div>
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>Не играет</span>
          )}
        </div>

        {/* Controls: Prev · Play/Pause · Next · Like */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <GhostBtn onClick={handlePrev}>
            <IconPrev />
          </GhostBtn>

          <MercuryBtn onClick={togglePlay} accent size={36}>
            {isPlaying ? <IconPause /> : <IconPlay />}
          </MercuryBtn>

          <GhostBtn onClick={next}>
            <IconNext />
          </GhostBtn>

          <GhostBtn onClick={() => void toggleLike()} active={isLiked}>
            <IconHeart filled={isLiked} />
          </GhostBtn>
        </div>
      </div>

      {/* Bottom glass highlight line */}
      <div
        aria-hidden
        style={{
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.06) 70%, transparent)',
          flexShrink: 0,
        }}
      />
    </div>
  );
}

export const MiniPlayer = () => (
  <MiniPlayerBoundary>
    <MiniPlayerInner />
  </MiniPlayerBoundary>
);
