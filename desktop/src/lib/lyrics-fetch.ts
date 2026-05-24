import type { Track } from '../stores/player';
import { resolveTrackMeta } from '../stores/track-overrides';
import { lrclibGet, lrclibSearch } from './lrclib';
import {
  getLyricsByTrack,
  type LyricsResult,
  searchLyricsManual,
  splitArtistTitle,
} from './lyrics';
import { getOfflineLyrics, rememberLyrics } from './offline-index';
import { getArtistDisplay } from './track-display';

/**
 * Normalises a SoundCloud username that may be CamelCase into a spaced name.
 * "KatyPerry" → "Katy Perry", "TheWeeknd" → "The Weeknd".
 * All-lowercase names ("twentyonepilots") are returned unchanged.
 */
function normalizeArtistName(name: string): string {
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return spaced !== name ? spaced : name;
}

/** Returns the first promise that resolves with synced lyrics, or null if none do. */
export function firstSynced(
  promises: Promise<LyricsResult | null>[],
): Promise<LyricsResult | null> {
  return new Promise((resolve) => {
    let remaining = promises.length;
    if (remaining === 0) {
      resolve(null);
      return;
    }
    for (const p of promises) {
      p.then((r) => {
        if (r?.synced?.length) resolve(r);
        else if (--remaining === 0) resolve(null);
      }).catch(() => {
        if (--remaining === 0) resolve(null);
      });
    }
  });
}

/**
 * Fetch lyrics for a track. Checks the local disk cache first (instant),
 * then hits the network in parallel (backend + LRCLib), and persists results
 * back to disk so future opens are instant.
 */
export async function fetchLyricsForTrack(track: Track): Promise<LyricsResult | null> {
  // 1. Disk cache — instant for replayed tracks
  const cached = await getOfflineLyrics(track.urn);
  if (cached?.synced?.length || cached?.plain) return cached;

  // Use saved override (user-edited title/artist) if available
  const resolved = resolveTrackMeta(track.urn, track.title, getArtistDisplay(track).primary);
  const parsed = splitArtistTitle(resolved.title);
  const rawArtist = parsed?.[0] ?? resolved.artist;
  const searchArtist = normalizeArtistName(rawArtist);
  const searchTitle = parsed?.[1] ?? resolved.title;
  const durationSec = track.duration > 0 ? track.duration / 1000 : undefined;

  // 2. Round 1: backend by URN + lrclib exact-match — return on first synced hit
  const urnP = getLyricsByTrack(track.urn);
  const lrcP = lrclibGet(searchArtist, searchTitle, durationSec);
  const synced1 = await firstSynced([urnP, lrcP]);
  if (synced1) {
    void rememberLyrics(track.urn, synced1);
    return synced1;
  }

  // 3. Round 2: backend fuzzy + lrclib fuzzy (also try title-only on lrclib as fallback)
  const backendP = searchLyricsManual(searchArtist, searchTitle, track.duration);
  const fuzzyP = lrclibSearch(searchArtist, searchTitle);
  // Title-only search catches tracks where artist name is still wrong/unknown
  const titleOnlyP = lrclibSearch('', searchTitle);
  const synced2 = await firstSynced([backendP, fuzzyP, titleOnlyP]);
  if (synced2) {
    void rememberLyrics(track.urn, synced2);
    return synced2;
  }

  // 4. Collect everything and return best plain-text fallback
  const [urn, lrc, bs, lf, lto] = await Promise.all([
    urnP.catch(() => null),
    lrcP.catch(() => null),
    backendP.catch(() => null),
    fuzzyP.catch(() => null),
    titleOnlyP.catch(() => null),
  ]);
  const fallback = lf?.plain ? lf : lto?.plain ? lto : bs?.plain ? bs : lrc?.plain ? lrc : urn;
  if (fallback) void rememberLyrics(track.urn, fallback);
  return fallback ?? null;
}

/** Query key for the auto lyrics query (matches the key used in LyricsPane). */
export function lyricsQueryKey(track: Track) {
  return ['lyrics', 'track', track.urn, track.title] as const;
}

/**
 * Batch-fetch and locally cache lyrics for a list of tracks.
 * Runs up to `concurrency` fetches in parallel, skips tracks that are
 * already in the offline lyrics cache.
 *
 * Fire-and-forget: does not throw. Suitable for background use alongside
 * audio caching (cache_likes, preloads, etc.).
 */
export async function cacheLyricsForTracks(
  tracks: Track[],
  concurrency = 3,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let done = 0;
  const total = tracks.length;

  // Process in sliding-window batches to respect concurrency limit
  let idx = 0;

  async function runOne(track: Track): Promise<void> {
    try {
      // Skip if already cached
      const cached = await getOfflineLyrics(track.urn);
      if (cached?.synced?.length || cached?.plain) return;
      await fetchLyricsForTrack(track);
    } catch {
      // Lyrics are best-effort — never block the bulk operation
    } finally {
      done++;
      onProgress?.(done, total);
    }
  }

  // Spawn `concurrency` workers that each pull from the shared index
  async function worker(): Promise<void> {
    while (idx < tracks.length) {
      const track = tracks[idx++];
      await runOne(track);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tracks.length) }, worker);
  await Promise.all(workers);
}
