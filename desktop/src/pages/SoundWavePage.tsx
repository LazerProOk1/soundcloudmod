/**
 * SoundWavePage — полноэкранный иммерсивный плеер в стиле Яндекс Музыки «Моя волна».
 *
 * Верстка:
 *   – яркий фон из доминирующего цвета обложки
 *   – вращающиеся световые лучи из центра (conic-gradient)
 *   – жёлтая надпись «Моя волна» + кнопка обновления справа
 *   – огромное имя артиста (clamp 44–96 px)
 *   – маленькая обложка (160 px) между «‹» и «›»
 *   – прогресс-бар
 *   – нижняя строка: [🔇][👎][  название  🎤][❤️]
 *   – подсказка-«Вибрация» внизу
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { rgbToCss, useArtworkColor } from '../hooks/useArtworkColor';
import { api } from '../lib/api';
import { handlePrev } from '../lib/audio';
import { art } from '../lib/formatters';
import { invalidateAllLikesCache, useLikedTracks, useRecommendedTracks, useRelatedPool } from '../lib/hooks';
import { Heart, MicVocal, RefreshCw, SkipBack, SkipForward } from '../lib/icons';
import { isUrnLiked, optimisticToggleLike } from '../lib/likes';
import { useArtistDisplay, useDisplayTitle } from '../lib/track-display';
import { useLyricsStore } from '../stores/lyrics';
import { type Track, usePlayerStore } from '../stores/player';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { ControlVolumeBtn, NowBarDislikeButton, ProgressSlider } from '../components/layout/NowPlayingBar';
import { useClusterWave } from '../components/music/cluster';
import { useInfiniteWave } from '../components/music/soundwave/use-infinite-wave';

/* ── Rotating feel-good tips ──────────────────────────────────────── */
const WAVE_TIPS = [
  'SoundWave подбирает треки именно для тебя',
  'Волна учится — чем больше слушаешь, тем точнее',
  'Музыка меняет настроение быстрее, чем кофе',
  'Каждый новый трек — маленькое открытие',
  'Твой вкус уникален — пусть SoundWave это докажет',
  'Алгоритм знает, что ты ещё не знаешь, что полюбишь',
  'Нажми следующий — может, лучший трек ещё впереди',
];

/* ── Module-level wave session tracker ────────────────────────────
 * Persists across SoundWavePage unmount/remount (navigation away and back).
 * Tracks every URN ever queued by the wave so isWaveTrack stays correct
 * even after infinite-wave refill adds tracks not in the initial cluster.
 * Cleared when the user starts playing from a non-wave source.            */
const _waveUrns = new Set<string>();
function _registerWave(urns: string[]) {
  for (const u of urns) _waveUrns.add(u);
}

/* ── Like button ──────────────────────────────────────────────────── */
function WaveLikeButton({ track }: { track: Track }) {
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
      className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-95 ${
        isLiked ? 'text-white bg-white/20' : 'text-white/55 hover:text-white hover:bg-white/10'
      }`}
    >
      <Heart size={22} fill={isLiked ? 'currentColor' : 'none'} />
    </button>
  );
}

/* ── SoundWavePage ────────────────────────────────────────────────── */
export function SoundWavePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const selectedLanguages = useSettingsStore((s) => s.soundwaveLanguages);
  const hideLiked = useSettingsStore((s) => s.soundwaveHideLiked);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playerNext = usePlayerStore((s) => s.next);

  const [refreshSeed, setRefreshSeed] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tipIdx] = useState(() => Math.floor(Math.random() * WAVE_TIPS.length));

  const stableLanguages = useMemo(() => [...selectedLanguages].sort(), [selectedLanguages]);
  const langKey = stableLanguages.join(',') || 'all';

  const url = useMemo(() => {
    if (!isAuthenticated) return null;
    const qs = new URLSearchParams();
    if (stableLanguages.length > 0) qs.set('languages', stableLanguages.join(','));
    if (refreshSeed > 0) qs.set('seed', String(refreshSeed));
    return `/recommendations?${qs}`;
  }, [isAuthenticated, stableLanguages, refreshSeed]);

  const { data, isLoading } = useClusterWave({
    queryKey: ['cluster-wave', 'sw-page', langKey, refreshSeed],
    url,
    enabled: isAuthenticated,
    staleMs: refreshSeed === 0 ? 30_000 : 0,
  });

  const rawAllTracks = useMemo(() => data?.allTracks ?? [], [data]);
  const rawClusters = useMemo(() => data?.clusters ?? [], [data]);

  /* Fallback: liked → related pool */
  const likedQuery = useLikedTracks(60);
  const { data: relatedPool } = useRelatedPool(likedQuery.tracks);
  const localRecs = useRecommendedTracks(relatedPool, 40);

  const backendWorking = rawClusters.length > 0 || rawAllTracks.length > 0;
  const hideLikedFilter = useCallback(
    (tr: Track) => !tr.user_favorite && !isUrnLiked(tr.urn),
    [],
  );

  const allTracks = useMemo(() => {
    const base = backendWorking ? rawAllTracks : localRecs;
    return hideLiked ? base.filter(hideLikedFilter) : base;
  }, [backendWorking, rawAllTracks, localRecs, hideLiked, hideLikedFilter]);

  const waveCluster = useMemo(
    () => rawClusters.find((c) => c.id === 'wave') ?? null,
    [rawClusters],
  );

  const onWaveTracksAdded = useCallback((tracks: typeof allTracks) => {
    _registerWave(tracks.map((t) => t.urn));
  }, []);

  useInfiniteWave({
    enabled: isAuthenticated,
    seedKind: 'user',
    initialTracks: waveCluster?.tracks ?? [],
    initialCursor: null,
    languages: stableLanguages,
    filterTrack: hideLiked ? hideLikedFilter : undefined,
    onTracksAdded: onWaveTracksAdded,
  });

  /* isWaveTrack: checks the module-level set that survives page navigation.
     Also clears the set when the user plays a non-wave track externally. */
  const isWaveTrack = currentTrack ? _waveUrns.has(currentTrack.urn) : false;

  useEffect(() => {
    if (currentTrack && !_waveUrns.has(currentTrack.urn) && _waveUrns.size > 0) {
      // User started playing from outside the wave — reset the wave session
      _waveUrns.clear();
    }
  }, [currentTrack]);

  /* Wave preview track (first recommendation). When not in wave mode, the page
     shows this as a preview of what the wave would play. */
  const wavePreview = allTracks[0] ?? null;

  /* The track to display:
     - in wave mode   → currently playing track
     - outside wave   → first wave recommendation (preview)
     - nothing playing → first wave recommendation */
  const displayTrack = isWaveTrack
    ? (currentTrack ?? wavePreview ?? null)
    : (wavePreview ?? currentTrack ?? null);

  /* Colors */
  const artworkUrl = art(displayTrack?.artwork_url, 't500x500');
  const colors = useArtworkColor(artworkUrl);

  const artistDisplay = useArtistDisplay(displayTrack ?? ({} as Track));
  const displayTitle = useDisplayTitle(displayTrack ?? ({} as Track));
  const openLyricsPanel = useLyricsStore((s) => s.openPanel);

  /* Yandex-style vivid background: 55% of dominant channel */
  const dom = colors?.dominant;
  const bgBase = dom
    ? `rgb(${Math.round(dom[0] * 0.55)},${Math.round(dom[1] * 0.5)},${Math.round(dom[2] * 0.5)})`
    : 'rgb(22,22,32)';

  /* Rays conic gradient helpers */
  const rc = dom ? rgbToCss(dom, 0.26) : 'rgba(255,255,255,0.12)';
  const rd = dom ? rgbToCss(dom, 0.12) : 'rgba(255,255,255,0.06)';
  const raysGradient = `conic-gradient(
    from 0deg,
    transparent 0deg,   ${rc} 2.5deg,  transparent 5deg,
    transparent 25deg,  ${rd} 27.5deg, transparent 30deg,
    transparent 50deg,  ${rc} 52.5deg,  transparent 55deg,
    transparent 75deg,  ${rd} 77.5deg, transparent 80deg,
    transparent 100deg, ${rc} 102.5deg, transparent 105deg,
    transparent 125deg, ${rd} 127.5deg, transparent 130deg,
    transparent 150deg, ${rc} 152.5deg, transparent 155deg,
    transparent 175deg, ${rd} 177.5deg, transparent 180deg,
    transparent 200deg, ${rc} 202.5deg, transparent 205deg,
    transparent 225deg, ${rd} 227.5deg, transparent 230deg,
    transparent 250deg, ${rc} 252.5deg, transparent 255deg,
    transparent 275deg, ${rd} 277.5deg, transparent 280deg,
    transparent 300deg, ${rc} 302.5deg, transparent 305deg,
    transparent 325deg, ${rd} 327.5deg, transparent 330deg,
    transparent 350deg, ${rc} 352.5deg, transparent 355deg,
    transparent 360deg
  )`;

  const handleStartWave = useCallback(() => {
    if (allTracks.length > 0) {
      _waveUrns.clear();
      _registerWave(allTracks.map((t) => t.urn));
      usePlayerStore.getState().play(allTracks[0], allTracks);
    }
  }, [allTracks]);

  const handlePlayPause = useCallback(() => {
    if (isWaveTrack) {
      togglePlay();
    } else if (allTracks.length > 0) {
      usePlayerStore.getState().play(allTracks[0], allTracks);
    }
  }, [isWaveTrack, allTracks, togglePlay]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setRefreshSeed((s) => s + 1);
    setTimeout(() => setIsRefreshing(false), 800);
  }, []);

  const artistTarget = displayTrack?.enrichment?.primary_artist?.id
    ? `/artist/${encodeURIComponent(displayTrack.enrichment.primary_artist.id)}`
    : displayTrack?.user?.urn
      ? `/user/${encodeURIComponent(displayTrack.user.urn)}`
      : null;

  if (!isAuthenticated) return null;

  return (
    <div
      className="relative w-full flex flex-col overflow-hidden"
      style={{
        minHeight: 'calc(100vh - 40px)',
        background: bgBase,
        transition: 'background 1.4s ease-out',
      }}
    >
      {/* ── Blurred artwork backdrop ──────────────────────────── */}
      {artworkUrl && (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${artworkUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(80px) saturate(1.8)',
            transform: 'scale(1.35) translateZ(0)',
            opacity: 0.5,
            transition: 'background-image 1.4s ease-out',
          }}
        />
      )}

      {/* ── Color blobs ───────────────────────────────────────── */}
      {colors && (
        <>
          <div
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{
              width: '180%',
              height: '80%',
              top: '-30%',
              left: '-40%',
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center, ${rgbToCss(colors.dominant, 0.55)} 0%, transparent 65%)`,
              filter: 'blur(60px)',
              transition: 'background 1.4s ease-out',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{
              width: '150%',
              height: '65%',
              bottom: '-15%',
              right: '-25%',
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center, ${rgbToCss(colors.secondary, 0.4)} 0%, transparent 65%)`,
              filter: 'blur(70px)',
              transition: 'background 1.4s ease-out',
            }}
          />
        </>
      )}

      {/* ── Rotating light rays ───────────────────────────────── */}
      <div
        aria-hidden="true"
        className="sw-rays-spinner absolute pointer-events-none"
        style={{
          width: '240%',
          height: '240%',
          top: '50%',
          left: '50%',
          background: raysGradient,
          borderRadius: '50%',
        }}
      />

      {/* ── Dark vignette (bottom → readable text) ────────────── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 130% 55% at 50% 90%, rgba(0,0,0,0.62) 0%, transparent 100%)',
        }}
      />
      {/* subtle top darkening */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-32 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.28) 0%, transparent 100%)',
        }}
      />

      {/* ═══════════════ CONTENT ═══════════════ */}
      <div className="relative z-10 flex flex-col flex-1" style={{ isolation: 'isolate' }}>

        {/* ── Header: title + refresh ───────────────────────── */}
        <div className="flex items-center justify-between px-8 pt-8 pb-0 shrink-0">
          <span
            className="text-[16px] font-bold tracking-tight select-none"
            style={{
              color: 'var(--color-accent)',
              fontFamily: 'var(--font-display)',
              WebkitFontSmoothing: 'antialiased',
            }}
          >
            {t('soundwave.myWave', 'Моя волна')}
          </span>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="flex items-center gap-2 pl-3.5 pr-4 py-2 rounded-full text-[12px] font-semibold text-white/85 hover:text-white transition-all duration-200 cursor-pointer disabled:opacity-40 active:scale-95 select-none"
            style={{
              background: 'rgba(255,255,255,0.16)',
              border: '1px solid rgba(255,255,255,0.20)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
            }}
          >
            <RefreshCw
              size={13}
              className={isRefreshing || isLoading ? 'animate-spin' : ''}
            />
            {t('soundwave.updateWave', 'Обновить волну')}
          </button>
        </div>

        {/* ── Artist name (big) ────────────────────────────── */}
        <div className="flex-1 flex items-end px-8 pb-5 min-h-0">
          {displayTrack ? (
            <h1
              className="text-white leading-none w-full"
              style={{
                fontSize: 'clamp(44px, 8vw, 96px)',
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                letterSpacing: '-0.04em',
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
                textRendering: 'optimizeLegibility',
                fontSynthesis: 'none',
                wordBreak: 'break-word',
                lineHeight: 1.0,
                cursor: artistTarget ? 'pointer' : 'default',
                textShadow: dom
                  ? `0 0 100px ${rgbToCss(dom, 0.45)}, 0 4px 32px rgba(0,0,0,0.40)`
                  : '0 4px 32px rgba(0,0,0,0.40)',
                transition: 'text-shadow 1.4s ease-out',
              }}
              onClick={artistTarget ? () => navigate(artistTarget) : undefined}
            >
              {artistDisplay.primary}
            </h1>
          ) : isLoading ? (
            <div className="h-16 w-56 rounded-2xl bg-white/10 animate-pulse" />
          ) : (
            <p className="text-[18px] text-white/30 font-semibold">
              {t('soundwave.idleTitle')}
            </p>
          )}
        </div>

        {/* ── Controls: Prev · Artwork+Play · Next ──────────── */}
        <div className="flex items-center justify-center gap-10 px-8 shrink-0">
          {/* Prev — hidden when wave inactive */}
          <button
            type="button"
            onClick={handlePrev}
            className={`w-12 h-12 rounded-full flex items-center justify-center text-white/65 hover:text-white hover:bg-white/[0.10] transition-all duration-200 cursor-pointer active:scale-95 ${
              !isWaveTrack && currentTrack ? 'invisible pointer-events-none' : ''
            }`}
          >
            <SkipBack size={26} strokeWidth={1.8} />
          </button>

          {/* Artwork with play/pause overlay */}
          <div
            className="relative rounded-2xl overflow-hidden cursor-pointer group/art shrink-0"
            style={{
              width: 220,
              height: 220,
              boxShadow: dom
                ? `0 24px 72px ${rgbToCss(dom, 0.70)}, 0 6px 18px rgba(0,0,0,0.55)`
                : '0 24px 72px rgba(0,0,0,0.55)',
              transition: 'box-shadow 1.4s ease-out',
            }}
            onClick={handlePlayPause}
          >
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt={displayTitle}
                className="w-full h-full object-cover transition-transform duration-700 group-hover/art:scale-[1.04]"
                decoding="async"
              />
            ) : (
              <div className="w-full h-full bg-white/[0.08]" />
            )}

            {/* Permanent dark overlay for play button visibility */}
            <div
              className="absolute inset-0"
              style={{ background: 'rgba(0,0,0,0.22)' }}
            />

            {/* Play / Pause button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-[64px] h-[64px] rounded-full flex items-center justify-center
                  transition-transform duration-200 group-hover/art:scale-110 active:scale-90"
                style={{
                  background: isWaveTrack && isPlaying
                    ? 'linear-gradient(165deg, rgba(255,255,255,0.98) 0%, rgba(218,218,230,0.93) 100%)'
                    : 'var(--color-accent)',
                  boxShadow: isWaveTrack && isPlaying
                    ? '0 1px 0 rgba(255,255,255,1) inset, 0 6px 20px rgba(0,0,0,0.45)'
                    : '0 6px 24px var(--color-accent-glow)',
                  color: isWaveTrack && isPlaying ? 'black' : 'white',
                }}
              >
                {isWaveTrack && isPlaying ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 3 }}>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </div>
            </div>
          </div>

          {/* Next — hidden when wave inactive */}
          <button
            type="button"
            onClick={playerNext}
            className={`w-12 h-12 rounded-full flex items-center justify-center text-white/65 hover:text-white hover:bg-white/[0.10] transition-all duration-200 cursor-pointer active:scale-95 ${
              !isWaveTrack && currentTrack ? 'invisible pointer-events-none' : ''
            }`}
          >
            <SkipForward size={26} strokeWidth={1.8} />
          </button>
        </div>

        {/* ── "Not from wave": big start button + now-playing hint ── */}
        {!isWaveTrack && currentTrack && (
          <div className="flex flex-col items-center gap-2 pt-5 pb-1 shrink-0">
            <button
              type="button"
              onClick={handleStartWave}
              disabled={allTracks.length === 0}
              className="flex items-center gap-2.5 pl-5 pr-6 py-3.5 rounded-full text-[15px] font-bold text-white cursor-pointer hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 select-none"
              style={{
                background: 'var(--color-accent)',
                boxShadow: '0 6px 28px var(--color-accent-glow)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}>
                <path d="M8 5v14l11-7z" />
              </svg>
              Запустить волну
            </button>
            <p className="text-[11px] text-white/30 select-none">
              сейчас: {currentTrack.title}
            </p>
          </div>
        )}

        {/* ── Progress bar (wave mode only) ────────────────── */}
        {isWaveTrack && (
          <div className="px-10 pt-5 pb-1 shrink-0">
            <ProgressSlider />
          </div>
        )}

        {/* ── Bottom bar (wave mode only): volume · dislike · pill · like ── */}
        {isWaveTrack && displayTrack && (
          <div className="flex items-center gap-2 px-5 pt-2 pb-4 shrink-0">
            <ControlVolumeBtn size="sm" />
            <NowBarDislikeButton trackUrn={displayTrack.urn} />

            {/* Track name pill */}
            <button
              type="button"
              onClick={() => navigate(`/track/${encodeURIComponent(displayTrack.urn)}`)}
              className="flex-1 min-w-0 flex items-center gap-2 px-4 py-2.5 rounded-full
                transition-all duration-200 cursor-pointer hover:bg-white/[0.16] active:scale-[0.98]"
              style={{
                background: 'rgba(255,255,255,0.13)',
                border: '1px solid rgba(255,255,255,0.16)',
              }}
            >
              <span className="flex-1 min-w-0 text-[13px] font-semibold text-white/92 truncate text-left">
                {displayTitle}
              </span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openLyricsPanel({ tab: 'lyrics', rightPanelOpen: true });
                }}
                className="shrink-0 text-white/35 hover:text-white/75 transition-colors cursor-pointer p-0.5"
              >
                <MicVocal size={14} />
              </span>
            </button>
            <WaveLikeButton track={displayTrack} />
          </div>
        )}

        {/* ── AI-style tip ──────────────────────────────────── */}
        <div className="flex items-start gap-2.5 px-7 pb-7 shrink-0">
          {/* Sparkle icon */}
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            className="shrink-0 mt-[3px] opacity-35"
            fill="white"
          >
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
          </svg>
          <p className="text-[12px] text-white/38 leading-relaxed select-none">
            {WAVE_TIPS[tipIdx % WAVE_TIPS.length]}
          </p>
        </div>
      </div>
    </div>
  );
}
