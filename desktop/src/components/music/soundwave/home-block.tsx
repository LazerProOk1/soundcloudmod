import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useLiquidLight } from '../../../lib/useLiquidLight';
import { useTranslation } from 'react-i18next';
import {
  AudioLines,
  Compass,
  Disc3,
  Headphones,
  playBlack14,
  RefreshCw,
  Search,
  Sparkles,
  Star,
} from '../../../lib/icons';
import { isUrnLiked } from '../../../lib/likes';
import { fetchWaveTailFromSeed, hydrateByIds, useSoundWaveSearch } from '../../../lib/soundwave';
import { useLikedTracks, useRecommendedTracks, useRelatedPool } from '../../../lib/hooks';
import { useAuthStore } from '../../../stores/auth';
import type { Track } from '../../../stores/player';
import { usePlayerStore } from '../../../stores/player';
import { useSettingsStore } from '../../../stores/settings';
import {
  ClusterEmptyState,
  type ClusterHydrated,
  type ClusterId,
  ClusterRow,
  ClusterSkeletonState,
  NeighborsRow,
  useClusterWave,
} from '../cluster';
import { AmbientLayer } from './ambient';
import { SearchHeader } from './headers';
import { HideLikedToggle } from './hide-liked-toggle';
import { LanguageFilter } from './language-filter';
import { RecommendationsStrip } from './strip';
import { WaveTrackHeader } from './track-header';
import { useInfiniteWave } from './use-infinite-wave';
import { LiveWaveform } from './waveform';

const CLUSTER_ORDER: ClusterId[] = [
  'for_you',
  'top_artists',
  'adjacent',
  'fresh_drops',
  'same_vibe',
  'deep_cuts',
];

const CLUSTER_ICON: Partial<Record<ClusterId, React.ReactNode>> = {
  for_you: <Sparkles size={14} />,
  top_artists: <Headphones size={14} />,
  adjacent: <Compass size={14} />,
  fresh_drops: <Disc3 size={14} />,
  same_vibe: <AudioLines size={14} />,
  deep_cuts: <Star size={14} />,
};

const WAVE_ICON = <AudioLines size={14} />;

export const SoundWaveBlock = React.memo(function SoundWaveBlock() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const selectedLanguages = useSettingsStore((s) => s.soundwaveLanguages);
  const setSelectedLanguages = useSettingsStore((s) => s.setSoundwaveLanguages);
  const hideLiked = useSettingsStore((s) => s.soundwaveHideLiked);
  const setHideLiked = useSettingsStore((s) => s.setSoundwaveHideLiked);

  const currentTrack = usePlayerStore((s) => s.currentTrack);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');
  /* Dynamic cursor spotlight — tracks mouse position on the glass panel */
  const panelRef = useLiquidLight<HTMLElement>();

  const stableLanguages = useMemo(() => [...selectedLanguages].sort(), [selectedLanguages]);
  const langKey = stableLanguages.join(',') || 'all';

  const url = useMemo(() => {
    if (!isAuthenticated) return null;
    const qs = new URLSearchParams();
    if (stableLanguages.length > 0) qs.set('languages', stableLanguages.join(','));
    const suffix = qs.toString() ? `?${qs}` : '';
    return `/recommendations${suffix}`;
  }, [isAuthenticated, stableLanguages]);

  const { data, isLoading, isFetching, refetch } = useClusterWave({
    queryKey: ['cluster-wave', 'home', langKey],
    url,
    enabled: isAuthenticated,
  });

  const {
    data: searchData,
    isLoading: searchLoading,
    isFetching: searchFetching,
  } = useSoundWaveSearch({ q: activeQuery, languages: stableLanguages });

  const rawClusters = useMemo(() => data?.clusters ?? [], [data]);
  const rawAllTracks = useMemo(() => data?.allTracks ?? [], [data]);

  // ── Fallback: SC native recommendations via liked tracks ──────
  // Used when the custom backend is unreachable (clusters stay empty).
  const likedQuery = useLikedTracks(60);
  const likedTracks = useMemo(() => likedQuery.tracks, [likedQuery.tracks]);
  const { data: relatedPool } = useRelatedPool(likedTracks);
  const localRecs = useRecommendedTracks(relatedPool, 40);

  const backendWorking = rawClusters.length > 0 || rawAllTracks.length > 0;

  // Fallback chain: backend → localRecs (SC-native related pool)
  // We do NOT fall back to liked tracks — user doesn't want to see them here
  const immediateBase = useMemo(() => {
    if (backendWorking) return rawAllTracks;
    return localRecs;
  }, [backendWorking, rawAllTracks, localRecs]);

  const filteredAllTracks = useMemo(() => {
    if (!hideLiked) return immediateBase;
    return immediateBase.filter((tr) => !tr.user_favorite && !isUrnLiked(tr.urn));
  }, [immediateBase, hideLiked]);

  const filteredClusters = useMemo(() => {
    if (!hideLiked) return rawClusters;
    return rawClusters
      .map((c) => ({
        ...c,
        tracks: c.tracks.filter((tr) => !tr.user_favorite && !isUrnLiked(tr.urn)),
        neighbors: c.neighbors?.filter((n) => {
          const matchTrack = c.tracks.find((tr) => tr.urn.endsWith(`:${n.track_id}`));
          if (!matchTrack) return true;
          return !matchTrack.user_favorite && !isUrnLiked(matchTrack.urn);
        }),
      }))
      .filter((c) => c.tracks.length > 0) as ClusterHydrated[];
  }, [rawClusters, hideLiked]);

  const orderedClusters = useMemo(() => {
    const byId = new Map(filteredClusters.map((c) => [c.id, c]));
    return CLUSTER_ORDER.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
  }, [filteredClusters]);

  const searchTracks = useMemo(() => searchData?.tracks ?? [], [searchData]);
  const isSearchMode = activeQuery.length >= 2;
  const searchBusy = searchLoading || searchFetching;

  const waveTrack = currentTrack ?? filteredAllTracks[0] ?? null;
  const isCurrent = !!currentTrack && waveTrack?.urn === currentTrack.urn;

  const fetchMore = useCallback(
    async () => fetchTail(stableLanguages, hideLiked),
    [stableLanguages, hideLiked],
  );

  useInfiniteWave({
    enabled: isAuthenticated && !isSearchMode,
    tracks: filteredAllTracks,
    fetchMore,
  });

  const handleSubmitSearch = useCallback((q: string) => setActiveQuery(q), []);
  const handleClearSearch = useCallback(() => {
    searchRef.current?.clear();
    setActiveQuery('');
  }, []);

  if (!isAuthenticated) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setTimeout(() => setIsRefreshing(false), 350);
    }
  };

  const handlePlayAll = () => {
    if (!filteredAllTracks.length) return;
    usePlayerStore.getState().play(filteredAllTracks[0], filteredAllTracks);
  };

  const spinning = isRefreshing || isFetching;
  // Show cold state only if truly nothing available (backend down + no liked tracks cached)
  const showCold = !isSearchMode && !isLoading && orderedClusters.length === 0 && immediateBase.length === 0;
  const showSearchEmpty = isSearchMode && !searchBusy && searchTracks.length === 0;
  const playableTracks = isSearchMode ? searchTracks : filteredAllTracks;

  return (
    <section
      ref={panelRef}
      className="relative rounded-3xl overflow-hidden glass-featured select-none"
      style={{
        boxShadow:
          '0 0 0 1px rgba(255,255,255,0.04) inset, 0 10px 60px rgba(0,0,0,0.45), 0 0 60px var(--color-accent-glow)',
        borderColor: 'rgba(255,255,255,0.08)',
      }}
    >
      <AmbientLayer particleCount={10} blur={35} intensity={0.5} />

      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden
        style={{
          background:
            /* Mesh background shows through at top, text stays readable at bottom */
            'linear-gradient(180deg, rgba(8,8,10,0.05) 0%, rgba(8,8,10,0.18) 50%, rgba(8,8,10,0.72) 100%)',
          contain: 'strict',
        }}
      />

      <div className="relative p-6 flex flex-col gap-5" style={{ isolation: 'isolate' }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="relative w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--color-accent), rgba(255,255,255,0.12))',
                boxShadow: '0 0 24px var(--color-accent-glow), inset 0 1px 0 rgba(255,255,255,0.2)',
              }}
            >
              <AudioLines size={18} style={{ color: 'var(--color-accent-contrast)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="soundwave-title text-[20px] font-bold tracking-tight leading-none">
                  SoundWave
                </h2>
              </div>
              <p className="text-[11.5px] text-white/50 mt-1 truncate">{t('soundwave.tagline')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <HideLikedToggle value={hideLiked} onChange={setHideLiked} />
            <LanguageFilter selected={selectedLanguages} onChange={setSelectedLanguages} />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={spinning}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] hover:border-white/[0.14] transition-colors duration-200 text-white/70 hover:text-white/95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('soundwave.refresh')}
            >
              <RefreshCw size={13} className={spinning ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={handlePlayAll}
              disabled={playableTracks.length === 0}
              className="flex items-center justify-center w-11 h-11 rounded-full transition-all duration-200 ease-[var(--ease-apple)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.93] hover:scale-[1.06]"
              style={{
                background: 'var(--color-accent)',
                boxShadow:
                  '0 6px 22px var(--color-accent-glow), inset 0 1px 0 rgba(255,255,255,0.30)',
              }}
              title={t('soundwave.playAll')}
            >
              {playBlack14}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {waveTrack ? (
            <WaveTrackHeader
              track={waveTrack}
              queue={playableTracks.length ? playableTracks : [waveTrack]}
              isCurrent={isCurrent}
            />
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-white/90 leading-tight">
                  {t('soundwave.idleTitle')}
                </p>
                <p className="text-[12px] text-white/45 mt-0.5 truncate">
                  {t('soundwave.idleSub')}
                </p>
              </div>
            </div>
          )}

          <LiveWaveform track={waveTrack} isCurrent={isCurrent} />
        </div>

        <div className="min-h-[280px]">
          {isSearchMode ? (
            <SearchSection
              query={activeQuery}
              count={searchTracks.length}
              tracks={searchTracks}
              busy={searchBusy}
              empty={showSearchEmpty}
              onClear={handleClearSearch}
            />
          ) : isLoading ? (
            <ClusterSkeletonState rows={3} itemsPerRow={6} />
          ) : showCold ? (
            <div className="flex flex-col items-center justify-center py-10 gap-5">
              <button
                type="button"
                onClick={handlePlayAll}
                disabled={playableTracks.length === 0}
                className="flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 ease-[var(--ease-apple)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.93] hover:scale-[1.08]"
                style={{
                  background: 'var(--color-accent)',
                  boxShadow: '0 8px 32px var(--color-accent-glow), 0 0 60px var(--color-accent-glow), inset 0 1px 0 rgba(255,255,255,0.30)',
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </button>
              <div className="text-center">
                <p className="text-[14px] font-semibold text-white/70">{t('soundwave.coldTitle', 'Начать слушать')}</p>
                <p className="text-[12px] text-white/35 mt-1">{t('soundwave.coldDesc', 'Лайкни пару треков — настроим волну')}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {filteredAllTracks.length > 0 && (
                <ClusterRow
                  clusterId="wave"
                  title={backendWorking ? t('soundwave.home.waveTitle') : localRecs.length > 0 ? t('home.recommended', 'Рекомендуем') : t('library.likedTracks', 'Понравившиеся')}
                  description={backendWorking ? t('soundwave.home.waveDesc') : localRecs.length > 0 ? t('discover.subtitle', 'Подобрано по твоим лайкам') : t('soundwave.idleSub', 'Ставь лайки — SoundWave настроит волну')}
                  icon={backendWorking ? WAVE_ICON : <Sparkles size={14} />}
                  index={0}
                  tracks={filteredAllTracks}
                  queue={filteredAllTracks}
                />
              )}
              {orderedClusters.map((c, idx) =>
                (c.id === 'top_artists' || c.id === 'adjacent') && c.neighbors ? (
                  <NeighborsRow
                    key={c.id}
                    title={t(`soundwave.home.cluster.${c.id}`)}
                    description={t(`soundwave.home.cluster.${c.id}Desc`)}
                    icon={CLUSTER_ICON[c.id]}
                    index={idx + 1}
                    cluster={c}
                    queue={filteredAllTracks}
                  />
                ) : (
                  <ClusterRow
                    key={c.id}
                    clusterId={c.id}
                    title={t(`soundwave.home.cluster.${c.id}`)}
                    description={t(`soundwave.home.cluster.${c.id}Desc`)}
                    icon={CLUSTER_ICON[c.id]}
                    index={idx + 1}
                    tracks={c.tracks}
                    queue={filteredAllTracks}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

interface SearchSectionProps {
  query: string;
  count: number;
  tracks: Track[];
  busy: boolean;
  empty: boolean;
  onClear: () => void;
}

const SearchSection = React.memo(function SearchSection({
  query,
  count,
  tracks,
  busy,
  empty,
  onClear,
}: SearchSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <SearchHeader query={query} count={count} onClear={onClear} />
      {busy ? (
        <ClusterSkeletonState rows={1} itemsPerRow={6} />
      ) : empty ? (
        <ClusterEmptyState
          icon={<Search size={18} style={{ color: 'var(--color-accent)' }} />}
          title={t('soundwave.searchEmptyTitle')}
          description={t('soundwave.searchEmptyDesc')}
        />
      ) : (
        <RecommendationsStrip tracks={tracks} />
      )}
    </div>
  );
});

async function fetchTail(languages: string[], hideLiked: boolean): Promise<Track[]> {
  const q = usePlayerStore.getState().queue;
  const last = q.length > 0 ? q[q.length - 1] : null;
  if (!last) return [];
  const trackId = String(last.urn.split(':').pop() ?? '');
  if (!trackId) return [];
  const recs = await fetchWaveTailFromSeed(trackId, { languages, mode: 'similar' });
  if (!recs.length) return [];
  const tracks = await hydrateByIds(recs);
  return hideLiked ? tracks.filter((tr) => !tr.user_favorite && !isUrnLiked(tr.urn)) : tracks;
}
