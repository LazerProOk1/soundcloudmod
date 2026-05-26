/**
 * SoundWavePanel
 *
 * Яндекс Музыка-style immersive right-side panel:
 *  – динамический фон из цветов обложки + вращающиеся световые лучи
 *  – большое имя артиста
 *  – обложка + prev/play-pause/next
 *  – прогресс-бар + нижняя плашка с названием трека и лайком
 *
 * Открывается кнопкой в NowPlayingBar (правый блок), анимация — слайд справа.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { rgbToCss, useArtworkColor } from '../../hooks/useArtworkColor';
import { api } from '../../lib/api';
import { handlePrev } from '../../lib/audio';
import { art } from '../../lib/formatters';
import { invalidateAllLikesCache, useLiquidGlass } from '../../lib/hooks';
import { Heart, SkipBack, SkipForward, X } from '../../lib/icons';
import { optimisticToggleLike } from '../../lib/likes';
import { useArtistDisplay, useDisplayTitle } from '../../lib/track-display';
import { useLyricsStore } from '../../stores/lyrics';
import { type Track, usePlayerStore } from '../../stores/player';
import { ProgressSlider } from '../layout/NowPlayingBar';

/* ── Like button (inline) ──────────────────────────────────────── */

function SwLikeButton({ track }: { track: Track }) {
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
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-95 ${
        isLiked ? 'text-white' : 'text-white/30 hover:text-white/70'
      }`}
      style={
        isLiked
          ? {
              background: 'rgba(255,255,255,0.15)',
              boxShadow: '0 0 20px rgba(255,255,255,0.12)',
            }
          : undefined
      }
    >
      <Heart size={20} fill={isLiked ? 'currentColor' : 'none'} />
    </button>
  );
}

/* ── Rotating light rays ────────────────────────────────────────── */

const LightRays = React.memo(function LightRays({
  color,
}: {
  color: [number, number, number];
}) {
  // 12 rays at 30° intervals — each ray is a conic slice
  const rayColor = rgbToCss(color, 0.18);
  const rayColorDim = rgbToCss(color, 0.08);

  return (
    <div
      aria-hidden="true"
      className="sw-rays-spinner absolute pointer-events-none"
      style={{
        // Place at center, size = 200% so rays fill the whole panel
        width: '200%',
        height: '200%',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: `conic-gradient(
          from 0deg,
          transparent 0deg,
          ${rayColor} 2.5deg,
          transparent 5deg,
          transparent 25deg,
          ${rayColorDim} 27.5deg,
          transparent 30deg,
          transparent 50deg,
          ${rayColor} 52.5deg,
          transparent 55deg,
          transparent 75deg,
          ${rayColorDim} 77.5deg,
          transparent 80deg,
          transparent 100deg,
          ${rayColor} 102.5deg,
          transparent 105deg,
          transparent 125deg,
          ${rayColorDim} 127.5deg,
          transparent 130deg,
          transparent 150deg,
          ${rayColor} 152.5deg,
          transparent 155deg,
          transparent 175deg,
          ${rayColorDim} 177.5deg,
          transparent 180deg,
          transparent 200deg,
          ${rayColor} 202.5deg,
          transparent 205deg,
          transparent 225deg,
          ${rayColorDim} 227.5deg,
          transparent 230deg,
          transparent 250deg,
          ${rayColor} 252.5deg,
          transparent 255deg,
          transparent 275deg,
          ${rayColorDim} 277.5deg,
          transparent 280deg,
          transparent 300deg,
          ${rayColor} 302.5deg,
          transparent 305deg,
          transparent 325deg,
          ${rayColorDim} 327.5deg,
          transparent 330deg,
          transparent 350deg,
          ${rayColor} 352.5deg,
          transparent 355deg,
          transparent 360deg
        )`,
        borderRadius: '50%',
      }}
    />
  );
});

/* ── Inner content (track guaranteed non-null) ─────────────────── */

interface SwContentProps {
  track: Track;
  onClose: () => void;
}

const SwContent = React.memo(function SwContent({ track, onClose }: SwContentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const glass = useLiquidGlass();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const openLyricsPanel = useLyricsStore((s) => s.openPanel);

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

  // Base bg color derived from dominant palette
  const bgBase = colors
    ? `rgb(${Math.round(colors.dominant[0] * 0.22)}, ${Math.round(colors.dominant[1] * 0.22)}, ${Math.round(colors.dominant[2] * 0.22)})`
    : 'rgb(8,8,12)';

  return (
    <div
      className="relative flex flex-col h-full overflow-hidden"
      style={{
        background: bgBase,
        transition: 'background 1.2s ease-out',
      }}
    >
      {/* ── Blurred artwork backdrop ─────────────────────────── */}
      {artworkLg && (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${artworkLg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(60px) saturate(1.4)',
            transform: 'scale(1.2) translateZ(0)',
            opacity: 0.28,
            transition: 'background-image 1s ease-out',
          }}
        />
      )}

      {/* ── Colour blobs ─────────────────────────────────────── */}
      {colors && (
        <>
          <div
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{
              width: '140%',
              height: '60%',
              top: '-10%',
              left: '-20%',
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center, ${rgbToCss(colors.dominant, 0.45)} 0%, transparent 70%)`,
              filter: 'blur(40px)',
              transition: 'background 1.2s ease-out',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{
              width: '120%',
              height: '50%',
              bottom: '-5%',
              right: '-10%',
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center, ${rgbToCss(colors.secondary, 0.3)} 0%, transparent 70%)`,
              filter: 'blur(50px)',
              transition: 'background 1.2s ease-out',
            }}
          />
        </>
      )}

      {/* ── Rotating light rays ──────────────────────────────── */}
      {colors && <LightRays color={colors.dominant} />}

      {/* ── Dark vignette for readability ────────────────────── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 100% 80% at 50% 0%, transparent 30%, rgba(0,0,0,0.50) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'rgba(0,0,0,0.15)',
        }}
      />

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
        <span
          className="text-[13px] font-bold tracking-tight"
          style={{
            color: colors ? rgbToCss(colors.dominant) : 'rgba(255,255,255,0.8)',
            filter: 'brightness(1.8) saturate(1.3)',
            fontFamily: 'var(--font-display)',
            WebkitFontSmoothing: 'antialiased',
          }}
        >
          SoundWave
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.08] transition-all duration-200 cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      {/* ── Artist name ──────────────────────────────────────── */}
      <div className="relative z-10 px-5 pt-2 pb-4 shrink-0">
        <h1
          className="font-extrabold leading-none tracking-tight text-white"
          style={{
            fontSize: 'clamp(28px, 9vw, 40px)',
            fontFamily: 'var(--font-display)',
            WebkitFontSmoothing: 'antialiased',
            textShadow: colors
              ? `0 2px 24px ${rgbToCss(colors.dominant, 0.6)}, 0 0 60px ${rgbToCss(colors.dominant, 0.3)}`
              : '0 2px 24px rgba(0,0,0,0.6)',
            lineHeight: 1.05,
            wordBreak: 'break-word',
            cursor: artistTarget ? 'pointer' : 'default',
          }}
          onClick={artistTarget ? () => navigateAndClose(artistTarget) : undefined}
        >
          {artistDisplay.primary}
        </h1>
      </div>

      {/* ── Spacer ───────────────────────────────────────────── */}
      <div className="flex-1 min-h-0" />

      {/* ── Artwork + controls ───────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center gap-5 px-5 shrink-0">
        {/* Artwork */}
        <div
          className="relative rounded-[28px] overflow-hidden"
          style={{
            width: 200,
            height: 200,
            flexShrink: 0,
            boxShadow: colors
              ? `0 20px 60px ${rgbToCss(colors.dominant, 0.6)}, 0 6px 24px rgba(0,0,0,0.55)`
              : '0 20px 60px rgba(0,0,0,0.6)',
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

          {/* Glass sheen on artwork */}
          {glass && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, transparent 50%, rgba(0,0,0,0.12) 100%)',
              }}
            />
          )}
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePrev}
            className="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-all duration-200 cursor-pointer"
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
            className="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-all duration-200 cursor-pointer"
          >
            <SkipForward size={22} />
          </button>
        </div>
      </div>

      {/* ── Spacer ───────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 max-h-8" />

      {/* ── Progress + track info ─────────────────────────────── */}
      <div className="relative z-10 px-5 pb-5 shrink-0">
        {/* Progress bar */}
        <div className="mb-3">
          <ProgressSlider />
        </div>

        {/* Track name pill + like */}
        <div
          className="flex items-center gap-2"
          style={{ minHeight: 44 }}
        >
          {/* Track name pill */}
          <button
            type="button"
            onClick={() => navigateAndClose(`/track/${encodeURIComponent(track.urn)}`)}
            className="flex-1 min-w-0 px-4 py-2.5 rounded-full text-left transition-all duration-200 cursor-pointer hover:bg-white/[0.12] active:scale-[0.98]"
            style={{
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <span
              className="block text-[13px] font-semibold text-white/90 truncate"
              style={{ WebkitFontSmoothing: 'antialiased' }}
            >
              {displayTitle}
            </span>
          </button>

          {/* Like button */}
          <SwLikeButton track={track} />
        </div>

        {/* Open lyrics button */}
        <div className="flex justify-center mt-2">
          <button
            type="button"
            onClick={() => {
              openLyricsPanel({ tab: 'lyrics', rightPanelOpen: true });
              onClose();
            }}
            className="text-[11px] text-white/25 hover:text-white/50 transition-colors cursor-pointer py-1"
          >
            {t('player.openLyrics', 'Open Lyrics')}
          </button>
        </div>
      </div>
    </div>
  );
});

/* ── SoundWavePanel (outer, manages mount/visible) ─────────────── */

export interface SoundWavePanelProps {
  open: boolean;
  onClose: () => void;
}

export const SoundWavePanel = React.memo(function SoundWavePanel({
  open,
  onClose,
}: SoundWavePanelProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      timerRef.current = setTimeout(() => setMounted(false), 380);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open]);

  // Escape key closes panel
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className="shrink-0 overflow-hidden"
      style={{
        width: visible ? 340 : 0,
        minWidth: visible ? 340 : 0,
        maxWidth: 340,
        transition: 'width 0.38s cubic-bezier(0.16,1,0.3,1), min-width 0.38s cubic-bezier(0.16,1,0.3,1)',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        className="h-full"
        style={{
          width: 340,
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.28s ease-out',
        }}
      >
        {currentTrack ? (
          <SwContent track={currentTrack} onClose={onClose} />
        ) : (
          /* Empty state — no track playing */
          <div className="h-full flex flex-col items-center justify-center gap-3 bg-[#08080c] px-6">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13M9 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm12 0c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z" />
              </svg>
            </div>
            <p className="text-[13px] text-white/25 text-center">Ничего не играет</p>
          </div>
        )}
      </div>
    </div>
  );
});
