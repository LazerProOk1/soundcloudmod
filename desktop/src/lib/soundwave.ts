import { useQuery } from '@tanstack/react-query';
import type { Track } from '../stores/player';
import { api } from './api';

export interface RecommendResult {
  id: string | number;
  score?: number;
  payload?: Record<string, unknown>;
}

export interface IndexingStats {
  indexed: number;
  pending: number;
}

const SW_STALE_MS = 0;
const SW_GC_MS = 1000 * 60 * 5;

function normLanguages(langs: string[] | undefined): string | undefined {
  if (!langs || langs.length === 0) return undefined;
  return [...langs].sort().join(',');
}

/**
 * Hydrate recommendation IDs → full SC track metadata, preserving order.
 *
 * Uses SoundCloud's batch endpoint `/tracks?ids=id1,id2,...` (up to 50 per call)
 * instead of individual per-track requests. This reduces N requests to ceil(N/50),
 * which eliminates rate-limit pressure on first load.
 *
 * If the batch endpoint fails (e.g. backend doesn't support it), falls back to
 * individual `/tracks/:urn` requests with concurrency-2 throttle.
 */
export async function hydrateByIds(recs: RecommendResult[]): Promise<Track[]> {
  const ids = recs
    .map((r) => String(r.id))
    .filter((id) => id && id !== 'undefined' && id !== 'null');
  if (!ids.length) return [];

  const BATCH_SIZE = 50;
  const allFetched: Track[] = [];
  let batchFailed = false;

  // ── Batch path: 1-2 requests instead of 50-90 ───────────────
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    try {
      const batch = await api<Track[]>(`/tracks?ids=${chunk.join(',')}`, { silent: true });
      if (Array.isArray(batch) && batch.length > 0) {
        allFetched.push(...batch);
      } else {
        // Empty array can mean the endpoint isn't supported — try fallback
        batchFailed = true;
        break;
      }
    } catch {
      batchFailed = true;
      break;
    }
  }

  // ── Fallback: individual requests (concurrency-2) if batch failed ──
  if (batchFailed) {
    const urns = ids.map((id) => `soundcloud:tracks:${id}`);
    const results: Array<Track | null> = new Array(urns.length);
    let index = 0;

    async function worker() {
      while (index < urns.length) {
        const i = index++;
        results[i] = await api<Track>(`/tracks/${encodeURIComponent(urns[i])}`, {
          silent: true,
        }).catch(() => null);
      }
    }

    await Promise.all(Array.from({ length: Math.min(2, urns.length) }, worker));
    return results.filter((t): t is Track => t !== null);
  }

  // Restore recommendation order
  const byId = new Map<string, Track>();
  for (const t of allFetched) {
    const numId = t.urn?.split(':').pop();
    if (numId) byId.set(numId, t);
    if (t.id != null) byId.set(String(t.id), t);
  }

  return ids.map((id) => byId.get(id)).filter((t): t is Track => t != null);
}

export type SmartWaveSeedKind = 'user' | 'track' | 'artist';

export interface SmartWaveBatch {
  tracks: Track[];
  cursor: string;
}

interface SmartWavePayload {
  tracks: RecommendResult[];
  cursor: string;
}

function smartWaveUrl(
  seedKind: SmartWaveSeedKind,
  seedId: string | undefined,
  qs: URLSearchParams,
): string {
  const q = qs.toString() ? `?${qs}` : '';
  switch (seedKind) {
    case 'user':
      return `/recommendations/wave${q}`;
    case 'track':
      return `/recommendations/wave/from-track/${encodeURIComponent(seedId!)}${q}`;
    case 'artist':
      return `/recommendations/wave/from-artist/${encodeURIComponent(seedId!)}${q}`;
  }
}

/**
 * Fetch a batch from the infinite SmartWave. The server holds state via cursor
 * (Redis, TTL 30 min) — pass the cursor back and get fresh tracks without repeats.
 * If cursor is absent or expired, the server starts a new session (transparent to UX).
 */
export async function fetchSmartWave(opts: {
  seedKind: SmartWaveSeedKind;
  seedId?: string;
  cursor?: string;
  limit?: number;
  languages?: string[];
}): Promise<SmartWaveBatch> {
  const qs = new URLSearchParams();
  qs.set('limit', String(opts.limit ?? 20));
  if (opts.cursor) qs.set('cursor', opts.cursor);
  const languages = normLanguages(opts.languages);
  if (languages) qs.set('languages', languages);

  const payload = await api<SmartWavePayload>(smartWaveUrl(opts.seedKind, opts.seedId, qs)).catch(
    () => ({ tracks: [], cursor: '' }) as SmartWavePayload,
  );

  if (!payload.tracks.length) return { tracks: [], cursor: payload.cursor };
  const tracks = await hydrateByIds(payload.tracks);
  return { tracks, cursor: payload.cursor };
}

/**
 * Report dis/pos outcomes from the recent wave window.
 * The server updates arm weights so the next fetchSmartWave returns better results.
 */
export async function sendWaveFeedback(opts: {
  cursor: string;
  negatives: number;
  positives: number;
}): Promise<string | null> {
  if (!opts.cursor) return null;
  try {
    const res = await api<{ ok: boolean; cursor?: string | null }>(
      '/recommendations/wave/feedback',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      },
    );
    return res?.cursor ?? null;
  } catch {
    return null;
  }
}

/**
 * React-Query wrapper for the first SmartWave batch.
 * Continued by `useInfiniteWave` which calls `fetchSmartWave({ cursor })` internally.
 */
export function useSmartWave(opts: {
  seedKind: SmartWaveSeedKind;
  seedId?: string;
  languages?: string[];
  enabled?: boolean;
  limit?: number;
}) {
  const enabled = opts.enabled !== false && (opts.seedKind === 'user' || !!opts.seedId);
  const languages = normLanguages(opts.languages);

  return useQuery<SmartWaveBatch>({
    queryKey: [
      'smartwave',
      opts.seedKind,
      opts.seedId ?? 'self',
      languages ?? 'all',
      opts.limit ?? 20,
    ],
    enabled,
    staleTime: SW_STALE_MS,
    gcTime: SW_GC_MS,
    queryFn: () =>
      fetchSmartWave({
        seedKind: opts.seedKind,
        seedId: opts.seedId,
        languages: opts.languages,
        limit: opts.limit,
      }),
  });
}

/**
 * Free-form vibe search. Returns hydrated tracks in Qdrant score order.
 * Kept flat (not cluster-grouped) — search is a single-intent query.
 */
export function useSoundWaveSearch(opts: { q: string; languages?: string[]; limit?: number }) {
  const q = opts.q.trim();
  const limit = opts.limit ?? 24;
  const languages = normLanguages(opts.languages);

  return useQuery({
    queryKey: ['soundwave', 'search', q, limit, languages ?? 'all'],
    enabled: q.length >= 2,
    staleTime: SW_STALE_MS,
    gcTime: SW_GC_MS,
    retry: 1,
    queryFn: async () => {
      const qs = new URLSearchParams({ q, limit: String(limit) });
      if (languages) qs.set('languages', languages);

      const recs = await api<RecommendResult[]>(
        `/recommendations/search?${qs}`,
        undefined,
        30_000,
      ).catch(() => [] as RecommendResult[]);
      if (!recs.length) return { tracks: [] as Track[], recs };

      const tracks = await hydrateByIds(recs);
      return { tracks, recs };
    },
  });
}

/** Optional lightweight poll of indexing stats. Fails silently if endpoint absent. */
export function useIndexingStats() {
  return useQuery({
    queryKey: ['soundwave', 'indexing-stats'],
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    retry: false,
    queryFn: () => api<IndexingStats>('/indexing/stats').catch(() => null as IndexingStats | null),
  });
}
