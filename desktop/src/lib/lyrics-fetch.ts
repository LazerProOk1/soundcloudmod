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

/**
 * Strips trailing upload-time annotations that are NOT part of the real song title
 * and would break exact-match lookups on LRCLib/backends.
 *
 * Examples:
 *   "звезда по имени солнце (2000 лет война)"  → "звезда по имени солнце"
 *   "Blinding Lights [Radio Edit]"              → "Blinding Lights"
 *   "Come As You Are (Remastered 2021)"         → "Come As You Are"
 *   "Lose Yourself (From 8 Mile Soundtrack)"    → "Lose Yourself"
 *
 * Leading parens like "(Keep Feeling) Fascination" are left untouched.
 * Multiple trailing groups are stripped iteratively.
 */
function cleanSearchTitle(title: string): string {
  let t = title.trim();
  // Iteratively remove trailing (…) / […] / （…） / 【…】 groups
  for (let i = 0; i < 3; i++) {
    const stripped = t.replace(/\s*[([（【][^)\]）】]{0,60}[)\]）】]\s*$/, '').trim();
    if (stripped === t || stripped.length === 0) break;
    t = stripped;
  }
  return t;
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

  // Clean title: strip trailing parenthetical/bracket annotations added by uploaders.
  // "звезда по имени солнце (2000 лет война)" → "звезда по имени солнце"
  const cleanTitle = cleanSearchTitle(searchTitle);
  const titleCleaned = cleanTitle !== searchTitle; // did stripping change anything?

  // 2. Round 1: backend by URN + lrclib exact-match (full title + cleaned title in parallel)
  const urnP = getLyricsByTrack(track.urn);
  const lrcP = lrclibGet(searchArtist, searchTitle, durationSec);
  const lrcCleanP = titleCleaned
    ? lrclibGet(searchArtist, cleanTitle, durationSec)
    : Promise.resolve(null);
  const synced1 = await firstSynced([urnP, lrcP, lrcCleanP]);
  if (synced1) {
    void rememberLyrics(track.urn, synced1);
    return synced1;
  }

  // 3. Round 2: backend fuzzy + lrclib fuzzy — full title + cleaned title + title-only
  const backendP = searchLyricsManual(searchArtist, searchTitle, track.duration);
  const fuzzyP = lrclibSearch(searchArtist, searchTitle, durationSec);
  const fuzzyCleanP = titleCleaned
    ? lrclibSearch(searchArtist, cleanTitle, durationSec)
    : Promise.resolve(null);
  // Title-only catches tracks where artist name is still wrong/unknown
  const titleOnlyP = lrclibSearch('', cleanTitle, durationSec);
  const synced2 = await firstSynced([backendP, fuzzyP, fuzzyCleanP, titleOnlyP]);
  if (synced2) {
    void rememberLyrics(track.urn, synced2);
    return synced2;
  }

  // 4. Collect everything and return best plain-text fallback
  const [urn, lrc, lrcClean, bs, lf, lfc, lto] = await Promise.all([
    urnP.catch(() => null),
    lrcP.catch(() => null),
    lrcCleanP.catch(() => null),
    backendP.catch(() => null),
    fuzzyP.catch(() => null),
    fuzzyCleanP.catch(() => null),
    titleOnlyP.catch(() => null),
  ]);
  const fallback = lf?.plain
    ? lf
    : lfc?.plain
      ? lfc
      : lto?.plain
        ? lto
        : bs?.plain
          ? bs
          : lrc?.plain
            ? lrc
            : lrcClean?.plain
              ? lrcClean
              : urn;
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
