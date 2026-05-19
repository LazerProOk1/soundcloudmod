import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TrackTitleArtist } from '../components/music/TrackTitleArtist';
import { VirtualList } from '../components/ui/VirtualList';
import { api } from '../lib/api';
import { listCachedUrns } from '../lib/cache';
import { art, dur } from '../lib/formatters';
import { fetchAllLikedTracks } from '../lib/hooks';
import {
  Clock,
  Download,
  Globe,
  Heart,
  Music,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from '../lib/icons';
import { getOfflineLikedTracks, getOfflineTracksByUrns } from '../lib/offline-index';
import { getArtistDisplay } from '../lib/track-display';
import { useAppStatusStore } from '../stores/app-status';
import type { Track } from '../stores/player';
import { usePlayerStore } from '../stores/player';

interface OfflineLibraryState {
  cachedTracks: Track[];
  likedTracks: Track[];
  cachedUrns: Set<string>;
}

interface PendingStats {
  pending: number;
  failed: number;
}

type OfflineSectionKey = 'likes' | 'cached';

const EMPTY_STATE: OfflineLibraryState = {
  cachedTracks: [],
  likedTracks: [],
  cachedUrns: new Set(),
};

const EMPTY_STATS: PendingStats = { pending: 0, failed: 0 };

function buildPlayableQueue(tracks: Track[], cachedUrns: Set<string>) {
  return tracks.filter((track) => cachedUrns.has(track.urn));
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function filterTracks(tracks: Track[], query: string): Track[] {
  if (!query) return tracks;
  return tracks.filter((track) => {
    const title = track.title?.toLowerCase() ?? '';
    if (title.includes(query)) return true;
    const artist = getArtistDisplay(track).primary.toLowerCase();
    return artist.includes(query);
  });
}

const OfflineSearchBar = React.memo(function OfflineSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group relative overflow-hidden rounded-[22px] border border-white/[0.10] bg-[linear-gradient(140deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02)_55%,rgba(255,255,255,0.05))] p-[1px] shadow-[0_18px_50px_rgba(0,0,0,0.30)] backdrop-blur-[36px] transition-colors focus-within:border-white/[0.18]">
      <div className="pointer-events-none absolute inset-0 rounded-[22px] bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.14),transparent_55%)]" />
      <div className="relative flex items-center gap-3 rounded-[21px] bg-black/35 px-4 py-2.5 backdrop-blur-[36px]">
        <Search size={15} className="text-white/40" strokeWidth={1.8} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('offline.searchPlaceholder')}
          className="w-full bg-transparent text-[13.5px] font-medium text-white/90 placeholder:text-white/30 focus:outline-none"
          aria-label={t('offline.searchPlaceholder')}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/55 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white/85"
            aria-label="clear"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </div>
  );
});

const StatusBadge = React.memo(function StatusBadge() {
  const { t } = useTranslation();
  const mode = useAppStatusStore((s) =>
    s.offlineBypass || !s.navigatorOnline || !s.backendReachable ? 'offline' : 'online',
  );

  const isOffline = mode === 'offline';

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1"
      style={{
        background: isOffline
          ? 'rgba(255,255,255,0.06)'
          : 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        border: isOffline
          ? '0.5px solid rgba(255,255,255,0.12)'
          : '0.5px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
        boxShadow: isOffline
          ? 'inset 0 1px 0 rgba(255,255,255,0.08)'
          : 'inset 0 1px 0 rgba(255,255,255,0.12), 0 0 16px color-mix(in srgb, var(--color-accent) 10%, transparent)',
      }}
    >
      {isOffline
        ? <Globe size={11} className="text-white/40" />
        : <Download size={11} style={{ color: 'var(--color-accent)' }} />
      }
      <span
        className="text-[11px] font-medium"
        style={{ color: isOffline ? 'rgba(255,255,255,0.45)' : 'var(--color-accent)' }}
      >
        {isOffline ? t('offline.offlineBadge') : t('offline.readyBadge')}
      </span>
    </div>
  );
});

const PendingBadge = React.memo(function PendingBadge({
  stats,
  syncing,
  onSync,
}: {
  stats: PendingStats;
  syncing: boolean;
  onSync: () => void;
}) {
  const { t } = useTranslation();

  if (stats.pending === 0 && stats.failed === 0) return null;

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/18 bg-accent/[0.10] px-3 py-1.5 text-[11px] font-semibold text-white/78 shadow-[0_0_16px_rgba(255,85,0,0.08)] backdrop-blur-sm">
        <Clock size={11} />
        {t('offline.pendingCount', { count: stats.pending })}
        {stats.failed > 0 && (
          <span className="ml-1 text-rose-300/80">
            ({t('offline.failedCount', { count: stats.failed })})
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-accent/18 bg-accent/[0.10] px-3 py-1.5 text-[11px] font-semibold text-white/78 transition-all hover:bg-accent/[0.16] disabled:opacity-50"
      >
        <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
        {t('offline.syncNow')}
      </button>
    </div>
  );
});

const OfflineTrackRow = React.memo(function OfflineTrackRow({
  track,
  queue,
  canPlay,
  showCachedBadge,
}: {
  track: Track;
  queue: Track[];
  canPlay: boolean;
  showCachedBadge: boolean;
}) {
  const { t } = useTranslation();
  const play = usePlayerStore((s) => s.play);
  const artwork = art(track.artwork_url, 't200x200');

  return (
    <div
      className={`group flex items-center gap-4 rounded-[24px] border px-4 py-3 transition-all duration-300 ease-[var(--ease-apple)] ${
        canPlay
          ? 'border-white/8 bg-white/[0.035] hover:border-white/14 hover:bg-white/[0.06] hover:shadow-[0_4px_24px_rgba(0,0,0,0.15)]'
          : 'border-white/6 bg-white/[0.02] opacity-60'
      }`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '82px' }}
    >
      <button
        type="button"
        onClick={() => canPlay && play(track, queue)}
        disabled={!canPlay}
        className={`relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border transition-all ${
          canPlay
            ? 'cursor-pointer border-white/12 bg-white/[0.08] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:scale-[1.03]'
            : 'cursor-not-allowed border-white/8 bg-white/[0.04] text-white/25'
        }`}
      >
        {artwork ? (
          <>
            <img
              src={artwork}
              alt=""
              className="size-full object-cover"
              decoding="async"
              loading="lazy"
            />
            {canPlay && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                <Play size={16} fill="white" strokeWidth={0} />
              </div>
            )}
          </>
        ) : (
          <Music size={18} />
        )}
      </button>

      <TrackTitleArtist track={track} size="md" />

      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        {showCachedBadge ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/16 bg-emerald-400/8 px-2.5 py-1 text-[11px] font-medium text-emerald-100/80">
            <Download size={12} />
            {t('offline.cached')}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/30">
            {t('offline.notCached')}
          </span>
        )}
      </div>

      <div className="w-14 shrink-0 text-right text-[12px] font-medium tabular-nums text-white/30">
        {dur(track.duration)}
      </div>
    </div>
  );
});

const OverviewMetric = React.memo(function OverviewMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div
      className="rounded-[26px] px-4 py-4"
      style={{
        background: 'rgba(10,10,14,0.30)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: `
          0 1px 0 0 rgba(255,255,255,0.18) inset,
          1px 0 0 0 rgba(255,255,255,0.09) inset,
          0 -1px 0 0 rgba(0,0,0,0.38) inset,
          0 0 0 0.5px rgba(255,255,255,0.07),
          0 8px 32px rgba(0,0,0,0.20)
        `,
      }}
    >
      {/* Liquid-glass icon pill */}
      <div
        className="flex size-11 items-center justify-center rounded-[18px] text-white/90"
        style={{
          background: 'linear-gradient(145deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 100%)',
          boxShadow: `
            0 1px 0 0 rgba(255,255,255,0.30) inset,
            0 -1px 0 0 rgba(0,0,0,0.22) inset,
            0 4px 14px rgba(0,0,0,0.20),
            0 0 0 0.5px var(--color-accent)
          `,
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'var(--color-accent)',
        }}
      >
        {icon}
      </div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
        {label}
      </div>
      <div className="mt-1 text-[30px] font-semibold tracking-[-0.05em] text-white/94">{value}</div>
    </div>
  );
});

const SectionSwitchCard = React.memo(function SectionSwitchCard({
  active,
  count,
  details,
  icon,
  onClick,
  title,
}: {
  active: boolean;
  count: number;
  details: Array<{ label: string; value: number }>;
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  // Both sections use accent colour — unified liquid-glass style
  const styles = {
    activeBorder: 'border-accent/20',
    activeBg: 'bg-accent/[0.07]',
    activeIcon: 'border-accent/20 bg-accent/[0.14] text-white/90',
    activeCount: 'border-accent/20 bg-accent/[0.14] text-white/90',
    glow: 'shadow-[0_18px_50px_var(--color-accent-glow,rgba(255,85,0,0.10))]',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full cursor-pointer rounded-[30px] border p-5 text-left transition-all duration-300 ease-[var(--ease-apple)] ${
        active
          ? `${styles.activeBorder} ${styles.activeBg} ${styles.glow}`
          : 'border-white/8 bg-white/[0.03] hover:border-white/12 hover:bg-white/[0.05]'
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex size-12 shrink-0 items-center justify-center rounded-[18px] transition-all duration-300 ${
            active ? styles.activeIcon : 'border border-white/10 bg-white/[0.05] text-white/60 group-hover:text-white/80'
          }`}
          style={active ? {
            boxShadow: '0 1px 0 0 rgba(255,255,255,0.28) inset, 0 -1px 0 0 rgba(0,0,0,0.20) inset, 0 4px 14px rgba(0,0,0,0.18)',
          } : {
            boxShadow: '0 1px 0 0 rgba(255,255,255,0.10) inset, 0 -1px 0 0 rgba(0,0,0,0.18) inset',
          }}
        >
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold tracking-tight text-white/92">{title}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {details.map((detail) => (
              <div
                key={detail.label}
                className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1.5"
              >
                <span className="text-[11px] font-medium text-white/36">{detail.label}</span>
                <span className="text-[11px] font-semibold tabular-nums text-white/88">
                  {detail.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
            active
              ? styles.activeCount
              : 'border-white/8 bg-white/[0.05] text-white/36 group-hover:text-white/52'
          }`}
        >
          {count}
        </div>
      </div>
    </button>
  );
});

function OfflineSection({
  icon,
  title,
  items,
  cachedUrns,
  emptyText,
  likesMode = false,
}: {
  icon: React.ReactNode;
  title: string;
  items: Track[];
  cachedUrns: Set<string>;
  emptyText: string;
  likesMode?: boolean;
}) {
  const playableQueue = useMemo(() => buildPlayableQueue(items, cachedUrns), [items, cachedUrns]);
  // Unified accent-based styles — no hardcoded section tones
  const styles = {
    border: 'border-accent/12',
    icon: 'border-accent/20 bg-accent/[0.12] text-white/90',
    badge: 'border-accent/20 bg-accent/[0.12] text-white/90',
    glow: '',
  };

  return (
    <section
      className={`relative overflow-hidden rounded-[34px] border ${styles.border} p-5 md:p-6 animate-liquid-reveal`}
      style={{
        /* Full liquid glass — background, blur, differential inset lighting */
        background: 'rgba(10, 10, 14, 0.38)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        boxShadow: `
          /* Differential border — top/left bright, bottom/right dark */
          0 1px 0 0 rgba(255,255,255,0.22) inset,
          1px 0 0 0 rgba(255,255,255,0.10) inset,
          0 -1px 0 0 rgba(0,0,0,0.42) inset,
          -1px 0 0 0 rgba(0,0,0,0.18) inset,
          /* Depth */
          0 24px 80px rgba(0,0,0,0.32),
          0 6px 24px rgba(0,0,0,0.20)
        `,
      }}
    >
      <div className={`pointer-events-none absolute inset-0 ${styles.glow}`} />

      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`flex size-12 shrink-0 items-center justify-center rounded-[18px] border ${styles.icon}`}
              style={{
                boxShadow: '0 1px 0 0 rgba(255,255,255,0.28) inset, 0 -1px 0 0 rgba(0,0,0,0.20) inset, 0 4px 16px rgba(0,0,0,0.18)',
              }}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-white/94">
                {title}
              </h2>
            </div>
          </div>

          <div
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${styles.badge}`}
          >
            {items.length}
          </div>
        </div>

        {items.length > 0 ? (
          <div className="border-t border-white/6 pt-4">
            <VirtualList
              items={items}
              rowHeight={82}
              overscan={8}
              getItemKey={(track) => track.urn}
              renderItem={(track, index) => {
                const isCached = cachedUrns.has(track.urn);
                return (
                  <div
                    className="animate-liquid-reveal"
                    style={{ animationDelay: `${Math.min(index * 35, 400)}ms` }}
                  >
                    <OfflineTrackRow
                      track={track}
                      queue={likesMode ? playableQueue : items}
                      canPlay={likesMode ? isCached : true}
                      showCachedBadge={isCached}
                    />
                  </div>
                );
              }}
            />
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-white/8 bg-white/[0.02] px-5 py-10 text-center text-[13px] text-white/30">
            {emptyText}
          </div>
        )}
      </div>
    </section>
  );
}

export const OfflinePage = React.memo(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const appMode = useAppStatusStore((s) =>
    s.offlineBypass || !s.navigatorOnline || !s.backendReachable ? 'offline' : 'online',
  );
  const [state, setState] = useState<OfflineLibraryState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [pendingStats, setPendingStats] = useState<PendingStats>(EMPTY_STATS);
  const [syncing, setSyncing] = useState(false);
  const [activeSection, setActiveSection] = useState<OfflineSectionKey>('likes');
  const [search, setSearch] = useState('');
  const bgFetchDone = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadOffline = async () => {
      try {
        const [likedTracks, cachedUrns] = await Promise.all([
          getOfflineLikedTracks(),
          listCachedUrns(),
        ]);
        const cachedSet = new Set(cachedUrns);
        const cachedTracks = await getOfflineTracksByUrns(cachedUrns);
        if (cancelled) return;

        setState({ likedTracks, cachedTracks, cachedUrns: cachedSet });
      } catch (error) {
        console.warn('[Offline] Failed to load local cache:', error);
        if (cancelled) return;
        setState(EMPTY_STATE);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadOffline();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (appMode !== 'online' || bgFetchDone.current) {
      return;
    }

    let cancelled = false;

    const syncAllLikes = async () => {
      try {
        const allLikes = await fetchAllLikedTracks();
        bgFetchDone.current = true;
        if (cancelled) return;

        const cachedUrns = await listCachedUrns();
        const cachedSet = new Set(cachedUrns);
        const cachedTracks = await getOfflineTracksByUrns(cachedUrns);
        if (cancelled) return;

        setState({ likedTracks: allLikes, cachedTracks, cachedUrns: cachedSet });
      } catch {
        // Offline mode can continue from local index only.
      }
    };

    void syncAllLikes();

    return () => {
      cancelled = true;
    };
  }, [appMode]);

  useEffect(() => {
    if (appMode !== 'online') {
      setSyncing(false);
      setPendingStats(EMPTY_STATS);
      return;
    }

    let cancelled = false;

    const loadStats = () => {
      api<PendingStats>('/pending-actions/stats', { silent: true })
        .then((stats) => {
          if (!cancelled) {
            setPendingStats(stats);
          }
        })
        .catch(() => {});
    };

    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [appMode]);

  useEffect(() => {
    if (
      activeSection === 'likes' &&
      state.likedTracks.length === 0 &&
      state.cachedTracks.length > 0
    ) {
      setActiveSection('cached');
    }

    if (
      activeSection === 'cached' &&
      state.cachedTracks.length === 0 &&
      state.likedTracks.length > 0
    ) {
      setActiveSection('likes');
    }
  }, [activeSection, state.cachedTracks.length, state.likedTracks.length]);

  const handleSync = useCallback(() => {
    if (appMode !== 'online') return;

    setSyncing(true);
    api<{ synced: number; failed: number }>('/pending-actions/sync', { method: 'POST', silent: true })
      .then(() => {
        api<PendingStats>('/pending-actions/stats', { silent: true })
          .then(setPendingStats)
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, [appMode]);

  const cachedLikesCount = useMemo(
    () => state.likedTracks.filter((track) => state.cachedUrns.has(track.urn)).length,
    [state.cachedUrns, state.likedTracks],
  );

  const normalizedQuery = useMemo(() => normalizeQuery(search), [search]);
  const filteredLikes = useMemo(
    () => filterTracks(state.likedTracks, normalizedQuery),
    [state.likedTracks, normalizedQuery],
  );
  const filteredCached = useMemo(
    () => filterTracks(state.cachedTracks, normalizedQuery),
    [state.cachedTracks, normalizedQuery],
  );

  const statusTitle = useMemo(() => {
    if (appMode === 'offline') return t('offline.offlineTitle');
    return t('offline.readyTitle');
  }, [appMode, t]);

  return (
    <div className="relative min-h-full overflow-hidden px-6 py-6 md:px-8 md:py-8 page-enter">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ contain: 'strict', transform: 'translateZ(0)' }}
      >
        <div className="absolute left-[-10%] top-[-8%] h-[480px] w-[480px] rounded-full bg-accent/[0.07] blur-[140px]" />
        <div className="absolute bottom-[-14%] right-[-10%] h-[520px] w-[520px] rounded-full bg-sky-400/[0.05] blur-[160px]" />
      </div>

      <div
        className="relative mx-auto flex w-full max-w-[1180px] flex-col gap-5"
        style={{ isolation: 'isolate' }}
      >
        <section className="relative overflow-hidden rounded-[38px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-[1px] shadow-[0_24px_80px_rgba(0,0,0,0.28),0_0_1px_rgba(255,255,255,0.1)] backdrop-blur-[40px]">
          <div className="pointer-events-none absolute inset-0 rounded-[38px] bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_60%)]" />

          <div className="relative rounded-[37px] bg-black/25 px-5 py-5 md:px-6 md:py-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <StatusBadge />

                <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-white/90 md:text-[32px]">
                  {statusTitle}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 xl:justify-end">
                <PendingBadge stats={pendingStats} syncing={syncing} onSync={handleSync} />
                <button
                  type="button"
                  onClick={() => {
                    useAppStatusStore.getState().resetConnectivity();
                    navigate('/home');
                  }}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-2xl px-4 py-2 text-[13px] font-medium text-white/60 transition-all hover:text-white/85"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '0.5px solid rgba(255,255,255,0.10)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                  }}
                >
                  <RotateCcw size={13} strokeWidth={1.8} />
                  {t('offline.tryOnline')}
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <OverviewMetric
                icon={<Heart size={18} />}
                label={t('offline.statsLikes')}
                value={state.likedTracks.length}
              />
              <OverviewMetric
                icon={<Download size={18} />}
                label={t('offline.statsPlayableLikes')}
                value={cachedLikesCount}
              />
              <OverviewMetric
                icon={<Download size={18} />}
                label={t('offline.statsCached')}
                value={state.cachedTracks.length}
              />
            </div>
          </div>
        </section>

        {loading ? (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="h-[148px] animate-pulse rounded-[30px] border border-white/6 bg-white/[0.02] backdrop-blur-[24px]"
                />
              ))}
            </div>
            <div className="h-[520px] animate-pulse rounded-[34px] border border-white/6 bg-white/[0.02] backdrop-blur-[24px]" />
          </>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionSwitchCard
                active={activeSection === 'likes'}
                count={state.likedTracks.length}
                details={[
                  { label: t('user.tracks'), value: state.likedTracks.length },
                  { label: t('offline.statsPlayableLikes'), value: cachedLikesCount },
                ]}
                icon={<Heart size={18} />}
                onClick={() => setActiveSection('likes')}
                title={t('offline.likesTitle')}
              />
              <SectionSwitchCard
                active={activeSection === 'cached'}
                count={state.cachedTracks.length}
                details={[
                  { label: t('user.tracks'), value: state.cachedTracks.length },
                  { label: t('offline.likesTitle'), value: cachedLikesCount },
                ]}
                icon={<Download size={18} />}
                onClick={() => setActiveSection('cached')}
                title={t('offline.cachedTitle')}
              />
            </div>

            <OfflineSearchBar value={search} onChange={setSearch} />

            {activeSection === 'likes' ? (
              <OfflineSection
                icon={<Heart size={18} />}
                title={t('offline.likesTitle')}
                items={filteredLikes}
                cachedUrns={state.cachedUrns}
                emptyText={normalizedQuery ? t('offline.searchEmpty') : t('offline.likesEmpty')}
                likesMode
              />
            ) : (
              <OfflineSection
                icon={<Download size={18} />}
                title={t('offline.cachedTitle')}
                items={filteredCached}
                cachedUrns={state.cachedUrns}
                emptyText={normalizedQuery ? t('offline.searchEmpty') : t('offline.cachedEmpty')}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});
