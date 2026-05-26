import {
  type DefaultError,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { Track } from '../stores/player';
import { usePlayerStore } from '../stores/player';
import { useSettingsStore } from '../stores/settings';
import { api } from './api';
import { initLikedUrns } from './likes';
import { rememberFollowingTracks, rememberLikedTracks, rememberTracks } from './offline-index';

/* ── Types ─────────────────────────────────────────────────────── */

export type FeedOrigin = Track & {
  track_count?: number;
  set_type?: string;
  tracks?: Track[];
};

export interface FeedItem {
  type: string;
  created_at: string;
  origin: FeedOrigin;
}

export interface PagedResponse<T> {
  collection: T[];
  page: number;
  page_size: number;
  has_more: boolean;
}

type TrackPage = PagedResponse<Track>;

export interface Comment {
  id: number;
  urn: string;
  body: string;
  created_at: string;
  timestamp: number | null;
  track_id: number;
  user: {
    id: number;
    urn: string;
    username: string;
    avatar_url: string;
    permalink_url: string;
  };
}

export interface Playlist {
  id: number;
  urn: string;
  title: string;
  permalink_url?: string;
  description: string | null;
  duration: number;
  artwork_url: string | null;
  genre: string;
  tag_list: string;
  track_count: number;
  likes_count: number;
  repost_count: number;
  created_at: string;
  last_modified: string;
  sharing: string;
  playlist_type: string;
  user_favorite?: boolean;
  tracks: Track[];
  user: {
    id: number;
    urn: string;
    username: string;
    avatar_url: string;
    permalink_url: string;
    followers_count?: number;
    track_count?: number;
  };
}

export interface SCUser {
  id: number;
  urn: string;
  username: string;
  avatar_url: string;
  permalink_url: string;
  followers_count?: number;
  followings_count?: number;
  track_count?: number;
  city?: string | null;
  country?: string | null;
}

export interface UserProfile extends SCUser {
  permalink: string;
  created_at: string;
  last_modified: string;
  first_name: string;
  last_name: string;
  full_name: string;
  description: string | null;
  country: string | null;
  public_favorites_count: number;
  reposts_count: number;
  plan: string;
  website_title: string | null;
  website: string | null;
  comments_count: number;
  online: boolean;
  likes_count: number;
  playlist_count: number;
}

export interface WebProfile {
  id: number;
  kind: string;
  service: string;
  title: string;
  url: string;
  username?: string;
}

const SHORT_CACHE_MS = 1000 * 60 * 2;
const MEDIUM_CACHE_MS = 1000 * 60 * 5;
const INFINITE_GC_MS = 1000 * 60 * 3;

/* ── Helpers ───────────────────────────────────────────────────── */

function flattenCollectionPages<T>(pages: Array<{ collection: T[] }> | undefined): T[] {
  if (!pages) return [];
  const items: T[] = [];
  for (const page of pages) {
    if (!page?.collection) continue;
    items.push(...page.collection);
  }
  return items;
}

export function dedupeByKey<T, K>(items: T[], getKey: (item: T) => K): T[] {
  const seen = new Set<K>();
  const unique: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function dedupeByUrn<T extends { urn: string }>(items: T[]): T[] {
  return dedupeByKey(items, (item) => item.urn);
}

interface PagedQueryOptions<T> {
  queryKey: QueryKey;
  /** Builds the URL for a given page index. limit and page are appended automatically. */
  url: (page: number, limit: number) => string;
  limit?: number;
  staleTime?: number;
  gcTime?: number;
  enabled?: boolean;
  maxPages?: number;
  /** Auto-fetch all pages until exhausted. Use sparingly. */
  autoFetchAll?: boolean;
  dedupe?: (item: T) => string;
  /** TanStack Query retry count. Defaults to 3; set to 1 for faster failure on flaky endpoints. */
  retry?: number | boolean;
  /** Request timeout in ms (default 60 000). Set lower for interactive queries. */
  timeoutMs?: number;
}

type PagedQueryResult<T> = UseInfiniteQueryResult<
  InfiniteData<PagedResponse<T>, number>,
  DefaultError
> & { items: T[] };

/**
 * Унифицированный page-based useInfiniteQuery helper. Бэк отдаёт
 * { collection, page, page_size, has_more } — этого достаточно для пагинации.
 */
function usePagedQuery<T>(opts: PagedQueryOptions<T>): PagedQueryResult<T> {
  const limit = opts.limit ?? 30;
  const query = useInfiniteQuery<
    PagedResponse<T>,
    DefaultError,
    InfiniteData<PagedResponse<T>, number>,
    QueryKey,
    number
  >({
    queryKey: opts.queryKey,
    queryFn: ({ pageParam }) =>
      api<PagedResponse<T>>(opts.url(pageParam, limit), {}, opts.timeoutMs),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    staleTime: opts.staleTime,
    gcTime: opts.gcTime ?? INFINITE_GC_MS,
    maxPages: opts.maxPages,
    enabled: opts.enabled,
    retry: opts.retry,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: opts.autoFetchAll is stable, query is captured
  useEffect(() => {
    if (!opts.autoFetchAll) return;
    if (query.hasNextPage && !query.isFetchingNextPage) {
      query.fetchNextPage();
    }
  }, [opts.autoFetchAll, query.hasNextPage, query.isFetchingNextPage, query.data]);

  // Stabilize dedupe function reference with a ref so the useMemo below only
  // recomputes when query.data actually changes — not on every render where the
  // caller passes an inline arrow function (which creates a new identity each time).
  const dedupeRef = useRef(opts.dedupe);
  dedupeRef.current = opts.dedupe;

  const items = useMemo(() => {
    const flat = flattenCollectionPages(query.data?.pages);
    return dedupeRef.current ? dedupeByKey(flat, dedupeRef.current) : flat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  return Object.assign(query, { items }) as PagedQueryResult<T>;
}

function pagedUrl(base: string, page: number, limit: number, extra?: string): string {
  const sep = base.includes('?') ? '&' : '?';
  const params = `limit=${limit}&page=${page}${extra ? `&${extra}` : ''}`;
  return `${base}${sep}${params}`;
}

/* ── History ───────────────────────────────────────────────────── */

export interface HistoryEntry {
  id: string;
  scTrackId: string;
  title: string;
  artistName: string;
  artistUrn: string | null;
  artworkUrl: string | null;
  duration: number;
  playedAt: string;
}

export function useHistory(limit = 50) {
  const { apiMode, directOAuthToken } = useSettingsStore();
  const isDirect = apiMode === 'direct' && directOAuthToken.trim().length > 0;
  const query = useInfiniteQuery({
    queryKey: ['history', isDirect],
    queryFn: async ({ pageParam = 0 }) => {
      // SoundCloud public API uses /me/play-history/tracks; our backend uses /history
      const path = isDirect
        ? `/me/play-history/tracks?limit=${limit}&offset=${pageParam}`
        : `/history?limit=${limit}&offset=${pageParam}`;
      const raw = await api<{ collection: unknown[]; total?: number; next_href?: string }>(path);
      // Normalize: direct API returns { collection: [{track, played_at}] }
      if (isDirect) {
        return {
          collection: raw.collection.map((item: unknown): HistoryEntry => {
            const e = item as Record<string, unknown>;
            const t = (e.track ?? {}) as Record<string, unknown>;
            const user = (t.user ?? {}) as Record<string, unknown>;
            return {
              id: String(t.urn ?? t.id ?? ''),
              scTrackId: String(t.urn ?? t.id ?? ''),
              title: String(t.title ?? ''),
              artistName: String(user.username ?? ''),
              artistUrn: (user.urn as string | null) ?? null,
              artworkUrl: (t.artwork_url as string | null) ?? null,
              duration: Number(t.duration ?? 0),
              playedAt: String(e.played_at ?? ''),
            };
          }),
          total: raw.collection.length,
        };
      }
      return raw as { collection: HistoryEntry[]; total: number };
    },
    initialPageParam: 0,
    gcTime: INFINITE_GC_MS,
    maxPages: 8,
    getNextPageParam: (last, _all, lastOffset) => {
      const nextOffset = (lastOffset as number) + limit;
      return nextOffset < last.total ? nextOffset : undefined;
    },
    // Was staleTime:0 — caused a background refetch on every navigation to History.
    // 30s window means re-visiting within half a minute reuses cached data.
    staleTime: 30_000,
  });

  const entries = useMemo(() => flattenCollectionPages(query.data?.pages), [query.data]);

  return { entries, ...query };
}

/* ── Featured ─────────────────────────────────────────────────── */

export interface FeaturedResponse {
  type: 'track' | 'playlist' | 'user';
  data: any;
}

export function useFeatured() {
  return useQuery<FeaturedResponse | null>({
    queryKey: ['featured'],
    queryFn: () => api<FeaturedResponse | null>('/featured'),
    staleTime: 5 * 60_000,
  });
}

/* ── Local Likes ──────────────────────────────────────────────── */

interface LocalLikesPage {
  collection: Track[];
  next_href: string | null;
}

export function useLocalLikes(limit = 50) {
  const query = useInfiniteQuery({
    queryKey: ['local-likes'],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (pageParam) params.set('cursor', pageParam as string);
      return api<LocalLikesPage>(`/local-likes?${params}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => {
      if (!last.next_href) return undefined;
      try {
        const url = new URL(last.next_href, 'http://x');
        return url.searchParams.get('cursor') || undefined;
      } catch {
        return undefined;
      }
    },
    staleTime: 30_000,
  });

  const tracks = useMemo(() => flattenCollectionPages(query.data?.pages), [query.data]);

  return { tracks, ...query };
}

/* ── Batch track hydration ─────────────────────────────────────── */

/**
 * Background-fetches full track objects for tracks missing publisher_metadata
 * and patches all related query-cache entries with the fresh data.
 *
 * SoundCloud feed/stream endpoints often return partial track objects that lack
 * publisher_metadata.artist (and therefore show the uploader channel name instead
 * of the real artist). Fetching /tracks?ids=... returns full objects with all fields.
 *
 * Note: feed returns publisher_metadata: null (not undefined) for tracks without it,
 * so we check !publisher_metadata?.artist rather than === undefined.
 */

/** Module-level set: URNs already submitted for hydration. Prevents re-hydration loops. */
const _hydratedUrns = new Set<string>();

export function useBatchTrackHydration(tracks: Track[]) {
  const qc = useQueryClient();
  const needsHydration = useMemo(
    () =>
      tracks.filter(
        (t) =>
          !_hydratedUrns.has(t.urn) &&
          !t.publisher_metadata?.artist &&
          !t.enrichment?.primary_artist?.name,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks.map((t) => t.urn).join(',')],
  );

  useEffect(() => {
    if (needsHydration.length === 0) return;

    const BATCH = 50;
    let cancelled = false;

    const run = async () => {
      for (let i = 0; i < needsHydration.length; i += BATCH) {
        if (cancelled) break;
        const batch = needsHydration.slice(i, i + BATCH);
        // Mark immediately — prevents parallel duplicate requests
        for (const t of batch) _hydratedUrns.add(t.urn);
        const ids = batch.map((t) => t.urn).join(',');
        try {
          const fresh = await api<Track[]>(`/tracks?ids=${encodeURIComponent(ids)}`, {
            silent: true,
          });
          if (cancelled) break;
          // Build a lookup map for O(1) access
          const byUrn = new Map<string, Track>(fresh.map((t) => [t.urn, t]));

          // Patch every cached page that references these tracks
          const patchTrack = (old: Track): Track => {
            const f = byUrn.get(old.urn);
            return f ? { ...old, ...f, user: old.user } : old;
          };

          // Patch feed pages
          qc.setQueriesData<InfiniteData<PagedResponse<FeedItem>, number>>(
            { queryKey: ['feed'] },
            (data) => {
              if (!data) return data;
              return {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  collection: page.collection.map((item) =>
                    item.origin?.urn && byUrn.has(item.origin.urn)
                      ? { ...item, origin: patchTrack(item.origin as Track) as FeedOrigin }
                      : item,
                  ),
                })),
              };
            },
          );

          // Patch any paged Track lists (likes, following, recommended, etc.)
          qc.setQueriesData<InfiniteData<PagedResponse<Track>, number>>(
            { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] !== 'feed' },
            (data) => {
              if (!data) return data;
              return {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  collection: page.collection.map(patchTrack),
                })),
              };
            },
          );
          // Also update the player store — currentTrack and queue are separate
          // from React Query and won't reflect the patched metadata otherwise.
          const playerStore = usePlayerStore.getState();
          for (const freshTrack of fresh) {
            playerStore.replaceTrackMetadata(freshTrack);
          }
        } catch {
          // On failure, remove from set so these tracks can be retried later
          for (const t of batch) _hydratedUrns.delete(t.urn);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [needsHydration, qc]);
}

/**
 * Hydrates the currently-playing track in the player store if it lacks
 * publisher_metadata.artist. Runs a single /tracks?ids= request and calls
 * replaceTrackMetadata so the artist name updates everywhere instantly.
 *
 * This covers tracks played from pages that don't call useBatchTrackHydration
 * (SoundWave, playlist pages, album pages, queue, etc.).
 */
export function useCurrentTrackHydration() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.publisher_metadata?.artist || currentTrack.enrichment?.primary_artist?.name)
      return;
    if (_hydratedUrns.has(currentTrack.urn)) return;

    _hydratedUrns.add(currentTrack.urn);
    api<Track[]>(`/tracks?ids=${encodeURIComponent(currentTrack.urn)}`, { silent: true })
      .then((fresh) => {
        if (fresh?.[0]) usePlayerStore.getState().replaceTrackMetadata(fresh[0]);
      })
      .catch(() => {
        _hydratedUrns.delete(currentTrack.urn);
      });
  }, [currentTrack?.urn]);
}

/* ── Feed ──────────────────────────────────────────────────────── */

export function useFeed() {
  const query = usePagedQuery<FeedItem>({
    queryKey: ['feed'],
    url: (page, limit) => pagedUrl('/me/feed', page, limit),
    limit: 20,
    staleTime: SHORT_CACHE_MS,
    maxPages: 8,
    dedupe: (item) => item.origin?.urn ?? `${item.type}:${item.created_at}`,
  });

  return {
    items: query.items,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
  };
}

/* ── Liked tracks ──────────────────────────────────────────────── */

export function useLikedTracks(limit = 30) {
  const query = usePagedQuery<Track>({
    queryKey: ['me', 'likes', 'tracks', limit],
    url: (page, l) => pagedUrl('/me/likes/tracks', page, l),
    limit,
    staleTime: SHORT_CACHE_MS,
  });

  const tracks = query.items;

  // Merged into one effect — both fired simultaneously from the same data update
  // anyway; running them separately caused two concurrent IndexedDB writes.
  useEffect(() => {
    if (!tracks.length) return;
    initLikedUrns(tracks);
    void rememberLikedTracks(tracks);
  }, [tracks]);

  return { tracks, ...query };
}

/**
 * Fetch ALL liked tracks. Page-based pagination, shared promise.
 * Optional onPage callback fires per page during the fetch.
 *
 * Fixes:
 * - Hard page cap (MAX_PAGES=50) prevents an infinite loop if `has_more` is always true
 * - Backoff on failure: retry with exponential delay instead of immediately nulling the
 *   shared promise, which would cause a retry storm on every caller
 */
const ALL_LIKES_MAX_PAGES = 50;
let _allLikesPromise: Promise<Track[]> | null = null;
let _allLikesRetryAt = 0; // wall-clock ms — don't retry before this

export function fetchAllLikedTracks(
  pageSize = 200,
  onPage?: (tracks: Track[]) => void,
): Promise<Track[]> {
  if (_allLikesPromise && !onPage) return _allLikesPromise;

  const promise = (async () => {
    const all: Track[] = [];
    for (let page = 0; page < ALL_LIKES_MAX_PAGES; page++) {
      const data = await api<TrackPage>(pagedUrl('/me/likes/tracks', page, pageSize));
      for (const t of data.collection) all.push(t);
      void rememberTracks(data.collection);
      onPage?.(data.collection);
      if (!data.has_more) break;
    }
    void rememberLikedTracks(all);
    return all;
  })();

  if (!onPage) {
    _allLikesPromise = promise;
    promise.catch(() => {
      // Exponential backoff: don't allow a retry for at least 30s after failure,
      // doubling up to 5min. This prevents a retry storm when the network is down.
      const backoffMs = Math.min(30_000 * 2 ** Math.round(_allLikesRetryAt / 60_000), 300_000);
      _allLikesRetryAt = Date.now() + backoffMs;
      _allLikesPromise = null;
    });
  }

  return promise;
}

export function invalidateAllLikesCache() {
  _allLikesPromise = null;
  _allLikesRetryAt = 0;
}

/* ── Fresh from followed artists ───────────────────────────────── */

export function useFollowingTracks(limit = 20) {
  const query = useQuery({
    queryKey: ['me', 'followings', 'tracks', limit],
    queryFn: () => api<TrackPage>(`/me/followings/tracks?limit=${limit}&page=0`),
    staleTime: SHORT_CACHE_MS,
    gcTime: INFINITE_GC_MS,
  });

  useEffect(() => {
    const tracks = query.data?.collection;
    if (tracks?.length) void rememberFollowingTracks(tracks);
  }, [query.data]);

  return query;
}

/* ── Track Comments (infinite) ─────────────────────────────────── */

export function useTrackComments(trackUrn: string | undefined) {
  const query = usePagedQuery<Comment>({
    queryKey: ['track', trackUrn, 'comments'],
    url: (page, limit) =>
      pagedUrl(`/tracks/${encodeURIComponent(trackUrn!)}/comments`, page, limit),
    limit: 20,
    staleTime: SHORT_CACHE_MS,
    maxPages: 6,
    enabled: !!trackUrn,
  });

  return { comments: query.items, ...query };
}

/* ── Post Comment ─────────────────────────────────────────────── */

export function usePostComment(trackUrn: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, timestamp }: { body: string; timestamp?: number }) => {
      return api<Comment>(`/tracks/${encodeURIComponent(trackUrn!)}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          comment: { body, timestamp: timestamp ?? 0 },
        }),
      });
    },
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['track', trackUrn, 'comments'] });
      qc.refetchQueries({ queryKey: ['track', trackUrn], exact: true });
    },
  });
}

/* ── Related Tracks ───────────────────────────────────────────── */

export function useRelatedTracks(trackUrn: string | undefined, limit = 10) {
  return useQuery({
    queryKey: ['track', trackUrn, 'related', limit],
    queryFn: () =>
      api<TrackPage>(`/tracks/${encodeURIComponent(trackUrn!)}/related?limit=${limit}&page=0`),
    enabled: !!trackUrn,
    staleTime: SHORT_CACHE_MS,
    gcTime: INFINITE_GC_MS,
  });
}

/* ── Track Favoriters ─────────────────────────────────────────── */

export function useTrackFavoriters(trackUrn: string | undefined, limit = 12) {
  return useQuery({
    queryKey: ['track', trackUrn, 'favoriters', limit],
    queryFn: () =>
      api<PagedResponse<SCUser>>(
        `/tracks/${encodeURIComponent(trackUrn!)}/favoriters?limit=${limit}&page=0`,
      ),
    enabled: !!trackUrn,
    staleTime: SHORT_CACHE_MS,
    gcTime: INFINITE_GC_MS,
  });
}

/* ── Playlist Detail ──────────────────────────────────────────── */

export function usePlaylist(playlistUrn: string | undefined) {
  return useQuery({
    queryKey: ['playlist', playlistUrn],
    queryFn: () => api<Playlist>(`/playlists/${encodeURIComponent(playlistUrn!)}`),
    enabled: !!playlistUrn,
    staleTime: MEDIUM_CACHE_MS,
    gcTime: INFINITE_GC_MS,
  });
}

/* ── Playlist Tracks ──────────────────────────────────────────── */

export function usePlaylistTracks(playlistUrn: string | undefined) {
  const query = usePagedQuery<Track>({
    queryKey: ['playlist', playlistUrn, 'tracks'],
    url: (page, limit) =>
      pagedUrl(`/playlists/${encodeURIComponent(playlistUrn!)}/tracks`, page, limit),
    limit: 200,
    staleTime: MEDIUM_CACHE_MS,
    enabled: !!playlistUrn,
    autoFetchAll: true,
  });

  return { tracks: query.items, ...query };
}

/* ── User Profile ─────────────────────────────────────────────── */

export function useUser(userUrn: string | undefined) {
  return useQuery({
    queryKey: ['user', userUrn],
    queryFn: () => api<UserProfile>(`/users/${encodeURIComponent(userUrn!)}`),
    enabled: !!userUrn,
    staleTime: MEDIUM_CACHE_MS,
    gcTime: INFINITE_GC_MS,
  });
}

export function useUserTracks(userUrn: string | undefined) {
  const query = usePagedQuery<Track>({
    queryKey: ['user', userUrn, 'tracks'],
    url: (page, limit) =>
      pagedUrl(
        `/users/${encodeURIComponent(userUrn!)}/tracks`,
        page,
        limit,
        'access=playable,preview,blocked',
      ),
    limit: 30,
    staleTime: SHORT_CACHE_MS,
    maxPages: 8,
    enabled: !!userUrn,
    dedupe: (t) => t.urn,
  });

  return { tracks: query.items, ...query };
}

export function useUserPopularTracks(userUrn: string | undefined) {
  return useQuery({
    queryKey: ['user', userUrn, 'tracks', 'popular'],
    queryFn: async ({ signal }) => {
      const all: Track[] = [];
      const pageSize = 50;
      // Hard cap at 10 pages (500 tracks) — prevents unbounded sequential API loop
      // for prolific artists. Pass signal so navigation cancels in-flight requests.
      const MAX_PAGES = 10;
      for (let page = 0; page < MAX_PAGES; page++) {
        if (signal?.aborted) break;
        const data = await api<TrackPage>(
          pagedUrl(
            `/users/${encodeURIComponent(userUrn!)}/tracks`,
            page,
            pageSize,
            'access=playable,preview,blocked',
          ),
          { signal }, // pass AbortSignal so navigation cancels in-flight requests
          10_000, // 10s per-page timeout instead of the 60s default
        );
        for (const t of data.collection) all.push(t);
        if (!data.has_more) break;
      }
      all.sort((a, b) => (b.playback_count ?? 0) - (a.playback_count ?? 0));
      return all;
    },
    enabled: !!userUrn,
    staleTime: SHORT_CACHE_MS,
    gcTime: INFINITE_GC_MS,
  });
}

export function useUserPlaylists(userUrn: string | undefined) {
  const query = usePagedQuery<Playlist>({
    queryKey: ['user', userUrn, 'playlists'],
    url: (page, limit) => pagedUrl(`/users/${encodeURIComponent(userUrn!)}/playlists`, page, limit),
    limit: 30,
    staleTime: SHORT_CACHE_MS,
    maxPages: 8,
    enabled: !!userUrn,
    dedupe: (p) => p.urn,
  });

  return { playlists: query.items, ...query };
}

export function useUserLikedTracks(userUrn: string | undefined) {
  const query = usePagedQuery<Track>({
    queryKey: ['user', userUrn, 'likes', 'tracks'],
    url: (page, limit) =>
      pagedUrl(
        `/users/${encodeURIComponent(userUrn!)}/likes/tracks`,
        page,
        limit,
        'access=playable,preview,blocked',
      ),
    limit: 30,
    staleTime: SHORT_CACHE_MS,
    maxPages: 8,
    enabled: !!userUrn,
    dedupe: (t) => t.urn,
  });

  return { tracks: query.items, ...query };
}

export function useUserFollowings(userUrn: string | undefined) {
  const query = usePagedQuery<SCUser>({
    queryKey: ['user', userUrn, 'followings'],
    url: (page, limit) =>
      pagedUrl(`/users/${encodeURIComponent(userUrn!)}/followings`, page, limit),
    limit: 30,
    staleTime: SHORT_CACHE_MS,
    maxPages: 8,
    enabled: !!userUrn,
    dedupe: (u) => u.urn,
  });

  return { users: query.items, ...query };
}

export function useUserFollowers(userUrn: string | undefined) {
  const query = usePagedQuery<SCUser>({
    queryKey: ['user', userUrn, 'followers'],
    url: (page, limit) => pagedUrl(`/users/${encodeURIComponent(userUrn!)}/followers`, page, limit),
    limit: 30,
    staleTime: SHORT_CACHE_MS,
    maxPages: 8,
    enabled: !!userUrn,
    dedupe: (u) => u.urn,
  });

  return { users: query.items, ...query };
}

export function useUserWebProfiles(userUrn: string | undefined) {
  return useQuery({
    queryKey: ['user', userUrn, 'web-profiles'],
    queryFn: () => api<WebProfile[]>(`/users/${encodeURIComponent(userUrn!)}/web-profiles`),
    enabled: !!userUrn,
    staleTime: MEDIUM_CACHE_MS,
    gcTime: INFINITE_GC_MS,
  });
}

export function useUserSubscription(_userUrn: string | undefined) {
  // Star subscription UI removed — always report no badge.
  return { data: false } as const;
}

/* ── My Library ────────────────────────────────────────────────── */

export function useMyFollowings(limit = 30) {
  const query = usePagedQuery<SCUser>({
    queryKey: ['me', 'followings', limit],
    url: (page, l) => pagedUrl('/me/followings', page, l),
    limit,
  });

  return { users: query.items, ...query };
}

export function useMyLikedPlaylists(limit = 30) {
  const query = usePagedQuery<Playlist>({
    queryKey: ['me', 'likes', 'playlists', limit],
    url: (page, l) => pagedUrl('/me/likes/playlists', page, l),
    limit,
  });

  return { playlists: query.items, ...query };
}

export function useMyPlaylists(limit = 30) {
  const query = usePagedQuery<Playlist>({
    queryKey: ['me', 'playlists', limit],
    url: (page, l) => pagedUrl('/me/playlists', page, l),
    limit,
  });

  return { playlists: query.items, ...query };
}

/* ── Playlist Mutations ────────────────────────────────────────── */

export function useUpdatePlaylistTracks(playlistUrn: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trackUrns: string[]) =>
      api<Playlist>(`/playlists/${encodeURIComponent(playlistUrn!)}`, {
        method: 'PUT',
        body: JSON.stringify({ playlist: { tracks: trackUrns.map((urn) => ({ urn })) } }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['playlist', playlistUrn], data);
      qc.invalidateQueries({ queryKey: ['playlist', playlistUrn, 'tracks'] });
      qc.invalidateQueries({ queryKey: ['me', 'playlists'] });
    },
  });
}

export function useAddToPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      playlistUrn,
      existingTrackUrns,
      newTrackUrns,
    }: {
      playlistUrn: string;
      existingTrackUrns: string[];
      newTrackUrns: string[];
    }) => {
      const allUrns = [...existingTrackUrns, ...newTrackUrns];
      return api<Playlist>(`/playlists/${encodeURIComponent(playlistUrn)}`, {
        method: 'PUT',
        body: JSON.stringify({ playlist: { tracks: allUrns.map((urn) => ({ urn })) } }),
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistUrn] });
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistUrn, 'tracks'] });
      qc.invalidateQueries({ queryKey: ['me', 'playlists'] });
    },
  });
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { title: string; sharing?: 'public' | 'private'; trackUrns?: string[] }) =>
      api<Playlist>('/playlists', {
        method: 'POST',
        body: JSON.stringify({
          playlist: {
            title: params.title,
            sharing: params.sharing ?? 'public',
            ...(params.trackUrns?.length
              ? { tracks: params.trackUrns.map((urn) => ({ urn })) }
              : {}),
          },
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'playlists'] });
    },
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playlistUrn: string) =>
      api(`/playlists/${encodeURIComponent(playlistUrn)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'playlists'] });
    },
  });
}

/* ── Search ────────────────────────────────────────────────────── */

export function useSearchTracks(q: string) {
  const query = usePagedQuery<Track>({
    queryKey: ['search', 'tracks', q],
    url: (page, limit) => pagedUrl('/tracks', page, limit, `q=${encodeURIComponent(q)}`),
    limit: 20,
    staleTime: SHORT_CACHE_MS,
    maxPages: 5,
    enabled: !!q.trim(),
    dedupe: (t) => t.urn,
    retry: 1,
    timeoutMs: 10_000,
  });

  return { tracks: query.items, ...query };
}

export function useSearchPlaylists(q: string) {
  const query = usePagedQuery<Playlist>({
    queryKey: ['search', 'playlists', q],
    url: (page, limit) => pagedUrl('/playlists', page, limit, `q=${encodeURIComponent(q)}`),
    limit: 20,
    staleTime: SHORT_CACHE_MS,
    maxPages: 5,
    enabled: !!q.trim(),
    dedupe: (p) => p.urn,
    retry: 2,
    timeoutMs: 12_000,
  });

  return { playlists: query.items, ...query };
}

export function useSearchUsers(q: string) {
  const query = usePagedQuery<SCUser>({
    queryKey: ['search', 'users', q],
    url: (page, limit) => pagedUrl('/users', page, limit, `q=${encodeURIComponent(q)}`),
    limit: 20,
    staleTime: SHORT_CACHE_MS,
    maxPages: 5,
    enabled: !!q.trim(),
    dedupe: (u) => u.urn,
    retry: 1,
    timeoutMs: 10_000,
  });

  return { users: query.items, ...query };
}

/* ── Fallback / Seed Tracks ────────────────────────────────────── */

/* ── Discover ──────────────────────────────────────────────────── */

type RelatedPool = Map<string, { count: number; track: Track }>;

function sampleTrackUrns(tracks: Track[], limit: number): string[] {
  if (tracks.length <= limit) {
    return tracks.map((track) => track.urn);
  }

  const sample = tracks.slice(0, limit);
  for (let i = limit; i < tracks.length; i++) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    if (swapIndex < limit) {
      sample[swapIndex] = tracks[i];
    }
  }

  return sample.map((track) => track.urn);
}

/**
 * Shared pool: fetches related tracks for up to 30 random liked tracks,
 * counts frequency of each related track. Used by both Recommended and Discover.
 */
export function useRelatedPool(likedTracks: Track[]) {
  // Stable seed — compute once when liked tracks first arrive, don't recompute on likes.
  // 5 seeds: enough diversity, fast enough (all run in parallel = ~1 round-trip).
  const seedRef = useRef<string[]>([]);
  if (seedRef.current.length === 0 && likedTracks.length > 0) {
    // 3 seeds: enough diversity, 2 fewer requests than 5 (less rate-limit pressure).
    seedRef.current = sampleTrackUrns(likedTracks, 3);
  }
  const seedUrns = seedRef.current;

  const likedUrns = useMemo(() => new Set(likedTracks.map((t) => t.urn)), [likedTracks]);

  return useQuery({
    queryKey: ['discover', 'related-pool', seedUrns],
    queryFn: async () => {
      // All requests fire in parallel — latency = 1 round-trip instead of 3 sequential batches.
      // silent: true suppresses 429 toasts — this is a fallback pool, missing it is fine.
      const results = await Promise.all(
        seedUrns.map((urn) => {
          // SoundCloud API v2 (Direct Mode) expects a numeric track ID, not a full URN.
          // URN format: "soundcloud:tracks:123456789" → extract "123456789"
          const trackId = urn.includes(':') ? (urn.split(':').pop() ?? urn) : urn;
          return api<TrackPage>(`/tracks/${encodeURIComponent(trackId)}/related?limit=20&page=0`, {
            silent: true,
          }).catch(
            () =>
              ({ collection: [] as Track[], page: 0, page_size: 20, has_more: false }) as TrackPage,
          );
        }),
      );

      const freq: RelatedPool = new Map();
      for (const res of results) {
        for (const track of res.collection) {
          if (likedUrns.has(track.urn)) continue;
          const entry = freq.get(track.urn);
          if (entry) entry.count++;
          else freq.set(track.urn, { count: 1, track });
        }
      }
      return freq;
    },
    enabled: seedUrns.length > 0,
    staleTime: 1000 * 60 * 15,
    gcTime: INFINITE_GC_MS,
  });
}

/** Top related tracks sorted by frequency — "Recommended For You"
 *  Artist-diversity cap: at most 2 tracks per artist to prevent one popular
 *  artist from dominating the entire recommendation shelf. */
export function useRecommendedTracks(pool: RelatedPool | undefined, limit = 40) {
  return useMemo(() => {
    if (!pool) return [];
    const sorted = [...pool.values()].sort((a, b) => b.count - a.count);
    const result: Track[] = [];
    const artistCount = new Map<string, number>();
    for (const { track } of sorted) {
      if (result.length >= limit) break;
      const key = track.user?.urn ?? track.user?.username ?? '';
      const n = key ? (artistCount.get(key) ?? 0) : 0;
      if (key && n >= 2) continue;
      if (key) artistCount.set(key, n + 1);
      result.push(track);
    }
    return result;
  }, [pool, limit]);
}

/** Related tracks grouped by genre, sorted by frequency — "Discover" */
export function useDiscoverData(pool: RelatedPool | undefined, likedTracks: Track[]) {
  const genreRanking = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of likedTracks) {
      const g = t.genre?.trim().toLowerCase();
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [likedTracks]);

  return useMemo(() => {
    if (!pool) return [];

    const byGenre = new Map<string, { count: number; track: Track }[]>();
    for (const entry of pool.values()) {
      const g = entry.track.genre?.trim().toLowerCase();
      if (!g) continue;
      const arr = byGenre.get(g);
      if (arr) arr.push(entry);
      else byGenre.set(g, [entry]);
    }

    for (const arr of byGenre.values()) {
      arr.sort((a, b) => b.count - a.count);
    }

    const result: { genre: string; tracks: Track[] }[] = [];
    for (const genre of genreRanking) {
      const entries = byGenre.get(genre);
      if (!entries || entries.length <= 3) continue;
      result.push({ genre, tracks: entries.map((e) => e.track) });
      if (result.length >= 7) break;
    }

    return result;
  }, [pool, genreRanking]);
}

/* ── Infinite scroll ───────────────────────────────────────────── */

/** Always returns true — liquid glass toggle has been removed from Settings */
export function useLiquidGlass() {
  return true;
}

export function useInfiniteScroll(
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  fetchNextPage: () => void,
) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;

    const root = el.closest('main');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          fetchNextPage();
        }
      },
      { root, rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return ref;
}
