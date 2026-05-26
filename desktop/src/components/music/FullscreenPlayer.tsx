/**
 * FullscreenPlayer
 *
 * Full-screen overlay that opens when the user clicks the artwork thumbnail
 * in the NowPlayingBar. Shows large artwork, track info, and playback controls.
 *
 * Opens with a bottom-sheet slide-up animation; closes with slide-down.
 * Dynamic background derives from useArtworkColor (same blobs as DynamicBackground).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { rgbToCss, useArtworkColor } from '../../hooks/useArtworkColor';
import { api } from '../../lib/api';
import { handlePrev } from '../../lib/audio';
import { art, dur } from '../../lib/formatters';
import { invalidateAllLikesCache, useLiquidGlass } from '../../lib/hooks';
import { Heart, SkipBack, SkipForward, X } from '../../lib/icons';
import { optimisticToggleLike } from '../../lib/likes';
import { useArtistDisplay, useDisplayTitle } from '../../lib/track-display';
import { useLyricsStore } from '../../stores/lyrics';
import { type Track, usePlayerStore } from '../../stores/player';
import { ProgressSlider } from '../layout/NowPlayingBar';

/* ── Like button ────────────────────────────────────────────── */

function FsLikeButton({ track }: { track: Track }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: trackData } = useQuery({
    queryKey: ['track', track.urn],
    queryFn: () => api<Track>(`/tracks/${encodeURIComponent(track.urn)}`),
    enabled: !!track.urn,
    staleTime: 30_000,
    initialData: track,
  });

  const [liked, setLiked] = useState<boolean | null>(null);
  const isLiked = liked ?? trackData?.user_favorite ?? false;

  const toggle = async () => {
    const next = !isLiked;
    setLiked(next);
    if (trackData) optimisticToggleLike(qc, trackData, next);
    invalidateAllLikesCache();
    try {
      await api(`/likes/tracks/${encodeURIComponent(track.urn)}`, {
        method: next ? 'POST' : 'DELETE',
      });
    } catch {
      setLiked(!next);
      if (trackData) optimisticToggleLike(qc, trackData, !next);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={t('track.likes')}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer hover:bg-white/[0.06] active:scale-95 ${
        isLiked ? 'text-accent' : 'text-white/40 hover:text-white/70'
      }`}
    >
      <Heart size={22} fill={isLiked ? 'currentColor' : 'none'} />
    </button>
  );
}

/* ── Inner content (track guaranteed non-null) ──────────────── */

interface FsContentProps {
  track: Track;
  visible: boolean;
  onClose: () => void;
}

const FsContent = React.memo(({ track, visible, onClose }: FsContentProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const glass = useLiquidGlass();
  const openLyricsPanel = useLyricsStore((s) => s.openPanel);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);

  const artworkLg = art(track.artwork_url, 't500x500');
  const colors = useArtworkColor(artworkLg);
  const artistDisplay = useArtistDisplay(track);
  const displayTitle = useDisplayTitle(track);

  const artistTarget = track.enrichment?.primary_artist?.id
    ? `/artist/${encodeURIComponent(track.enrichment.primary_artist.id)}`
    : track.user?.urn
      ? `/user/${encodeURIComponent(track.user.urn)}`
      : null;

  const navigateAndClose = useCallback(
    (path: string) => {
      navigate(path);
      onClose();
    },
    [navigate, onClose],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex flex-col items-center justify-center overflow-hidden"
      style={{
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.42s cubic-bezier(0.16,1,0.3,1)',
        background: 'rgb(8,8,10)',
      }}
    >
      {/* Dynamic colour backdrop */}
      {artworkLg && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url(${artworkLg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(80px) saturate(1.6)',
              transform: 'scale(1.15) translateZ(0)',
              opacity: 0.3,
            }}
          />
          {colors && (
            <>
              <div
                aria-hidden="true"
                className="absolute pointer-events-none"
                style={{
                  width: '60vw',
                  height: '60vh',
                  top: '-10vh',
                  left: '-10vw',
                  borderRadius: '50%',
                  background: `radial-gradient(ellipse at center, ${rgbToCss(colors.dominant, 0.35)} 0%, transparent 70%)`,
                  filter: 'blur(80px)',
                }}
              />
              <div
                aria-hidden="true"
                className="absolute pointer-events-none"
                style={{
                  width: '50vw',
                  height: '50vh',
                  bottom: '-5vh',
                  right: '-5vw',
                  borderRadius: '50%',
                  background: `radial-gradient(ellipse at center, ${rgbToCss(colors.secondary, 0.28)} 0%, transparent 70%)`,
                  filter: 'blur(90px)',
                }}
              />
            </>
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 120% 120% at 50% 50%, rgba(6,6,9,0.55) 0%, rgba(6,6,9,0.88) 100%)',
            }}
          />
        </>
      )}

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-5 right-5 z-20 w-10 h-10 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-all duration-200 cursor-pointer"
      >
        <X size={18} />
      </button>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-sm px-6">
        {/* Artwork */}
        <div
          className="glass-artwork rounded-[32px] overflow-hidden"
          style={{
            width: 280,
            height: 280,
            flexShrink: 0,
            ['--artwork-radius' as string]: '32px',
            boxShadow: colors
              ? `0 24px 80px ${rgbToCss(colors.dominant, 0.55)}, 0 8px 32px rgba(0,0,0,0.6)`
              : '0 24px 80px rgba(0,0,0,0.6)',
            transition: 'box-shadow 1s ease-out',
          }}
        >
          {artworkLg ? (
            <img
              src={artworkLg}
              alt={track.title}
              className="w-full h-full object-cover"
              decoding="async"
            />
          ) : (
            <div className="w-full h-full bg-white/[0.06]" />
          )}
        </div>

        {/* Track info */}
        <div className="text-center min-w-0 w-full px-4">
          <p
            className="text-[17px] font-semibold text-white/95 leading-tight truncate cursor-pointer hover:text-white transition-colors"
            onClick={() => navigateAndClose(`/track/${encodeURIComponent(track.urn)}`)}
          >
            {displayTitle}
          </p>
          <p
            className={`text-[13px] text-white/45 mt-1 truncate transition-colors ${
              artistTarget ? 'cursor-pointer hover:text-white/70' : ''
            }`}
            onClick={artistTarget ? () => navigateAndClose(artistTarget) : undefined}
          >
            {artistDisplay.primary}
          </p>
        </div>

        {/* Like */}
        <FsLikeButton track={track} />

        {/* Progress slider */}
        <div className="w-full">
          <ProgressSlider />
          <div className="flex justify-end mt-1">
            <span className="text-[10px] text-white/20 tabular-nums">{dur(track.duration)}</span>
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handlePrev}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.06] transition-all duration-200 cursor-pointer"
          >
            <SkipBack size={22} />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="w-16 h-16 rounded-full flex items-center justify-center text-black hover:scale-[1.06] active:scale-[0.94] transition-all duration-300 ease-[var(--ease-spring)] cursor-pointer"
            style={{
              background:
                'linear-gradient(165deg, rgba(255,255,255,0.98) 0%, rgba(230,230,236,0.93) 100%)',
              boxShadow: glass
                ? '0 1px 0 0 rgba(255,255,255,1) inset, 0 -1px 0 0 rgba(0,0,0,0.22) inset, 0 6px 24px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.18)'
                : '0 6px 24px rgba(0,0,0,0.45)',
            }}
          >
            {isPlaying ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="black">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="black"
                style={{ marginLeft: 3 }}
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={next}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.06] transition-all duration-200 cursor-pointer"
          >
            <SkipForward size={22} />
          </button>
        </div>

        {/* Open lyrics link */}
        <button
          type="button"
          onClick={() => {
            openLyricsPanel({ tab: 'lyrics', rightPanelOpen: true });
            onClose();
          }}
          className="text-[11px] text-white/30 hover:text-white/60 transition-colors cursor-pointer"
        >
          {t('player.openLyrics', 'Open Lyrics')}
        </button>
      </div>
    </div>,
    document.body,
  );
});

/* ── FullscreenPlayer (outer, manages mount/unmount) ────────── */

interface FullscreenPlayerProps {
  open: boolean;
  onClose: () => void;
}

export const FullscreenPlayer = React.memo(({ open, onClose }: FullscreenPlayerProps) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      closeTimerRef.current = setTimeout(() => setMounted(false), 420);
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!mounted || !currentTrack) return null;

  return <FsContent track={currentTrack} visible={visible} onClose={onClose} />;
});
