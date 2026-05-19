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
        results[i] = await api<Track>(
          `/tracks/${encodeURIComponent(urns[i])}`,
          { silent: true },
        ).catch(() => null);
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

export type SoundWaveMode = 'similar' | 'diverse';

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

/**
 * Continuation tail seeded by the last queued track. Used by the infinite scroll
 * extension of the home wave's deep_cuts cluster.
 */
export async function fetchWaveTailFromSeed(
  seedTrackId: string,
  opts: { languages?: string[]; mode: SoundWaveMode; limit?: number },
): Promise<RecommendResult[]> {
  const qs = new URLSearchParams({
    limit: String(opts.limit ?? 20),
    mode: opts.mode,
  });
  const languages = normLanguages(opts.languages);
  if (languages) qs.set('languages', languages);
  return api<RecommendResult[]>(
    `/recommendations/tail/${encodeURIComponent(seedTrackId)}?${qs}`,
  ).catch(() => [] as RecommendResult[]);
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
