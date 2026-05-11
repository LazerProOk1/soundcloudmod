import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { LyricLine, LyricsResult, LyricsSource } from './lyrics';
import type { Track } from '../stores/player';

const BASE_DIR = BaseDirectory.AppData;
const INDEX_PATH = 'offline-index.json';

const RECENTLY_PLAYED_LIMIT = 60;
const FOLLOWING_TRACKS_LIMIT = 40;
/** Max lyrics entries to keep (old ones are evicted by cachedAt). */
const LYRICS_CACHE_LIMIT = 500;

export interface CachedLyrics {
  lines: LyricLine[] | null;
  plain: string | null;
  source: LyricsSource;
  cachedAt: number;
}

interface OfflineIndex {
  likedUrns: string[];
  followingUrns: string[];
  recentlyPlayedUrns: string[];
  tracksByUrn: Record<string, Track>;
  lyricsByUrn: Record<string, CachedLyrics>;
  updatedAt: number | null;
}

const EMPTY_INDEX: OfflineIndex = {
  likedUrns: [],
  followingUrns: [],
  recentlyPlayedUrns: [],
  tracksByUrn: {},
  lyricsByUrn: {},
  updatedAt: null,
};

let indexCache: OfflineIndex | null = null;
let loadPromise: Promise<OfflineIndex> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let dirReady: Promise<void> | null = null;

function ensureDir() {
  if (!dirReady) {
    dirReady = mkdir('', { baseDir: BASE_DIR, recursive: true }).catch(() => {});
  }
  return dirReady;
}

function cloneTrack(track: Track): Track {
  return {
    ...track,
    user: { ...track.user },
  };
}

async function readIndexFile(): Promise<OfflineIndex> {
  await ensureDir();

  try {
    if (!(await exists(INDEX_PATH, { baseDir: BASE_DIR }))) {
      return EMPTY_INDEX;
    }

    const raw = await readTextFile(INDEX_PATH, { baseDir: BASE_DIR });
    const parsed = JSON.parse(raw) as OfflineIndex;
    return {
      likedUrns: Array.isArray(parsed.likedUrns) ? parsed.likedUrns : [],
      followingUrns: Array.isArray(parsed.followingUrns) ? parsed.followingUrns : [],
      recentlyPlayedUrns: Array.isArray(parsed.recentlyPlayedUrns) ? parsed.recentlyPlayedUrns : [],
      tracksByUrn: parsed.tracksByUrn ?? {},
      lyricsByUrn: parsed.lyricsByUrn ?? {},
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return EMPTY_INDEX;
  }
}

async function loadIndex(): Promise<OfflineIndex> {
  if (indexCache) {
    return indexCache;
  }

  if (!loadPromise) {
    loadPromise = readIndexFile()
      .then((parsed) => {
        indexCache = parsed;
        return parsed;
      })
      .finally(() => {
        loadPromise = null;
      });
  }

  return loadPromise;
}

function schedulePersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!indexCache) return;

    void ensureDir().then(() =>
      writeTextFile(INDEX_PATH, JSON.stringify(indexCache), { baseDir: BASE_DIR }).catch(() => {}),
    );
  }, 120);
}

export async function rememberTracks(tracks: Track[]) {
  if (tracks.length === 0) return;

  const index = await loadIndex();
  let changed = false;

  for (const track of tracks) {
    if (!track?.urn) continue;
    index.tracksByUrn[track.urn] = cloneTrack(track);
    changed = true;
  }

  if (changed) {
    schedulePersist();
  }
}

export async function rememberLikedTracks(tracks: Track[]) {
  const index = await loadIndex();
  for (const track of tracks) {
    if (!track?.urn) continue;
    index.tracksByUrn[track.urn] = cloneTrack(track);
  }

  index.likedUrns = tracks.map((track) => track.urn);
  index.updatedAt = Date.now();
  schedulePersist();
}

export async function getOfflineLikedTracks() {
  const index = await loadIndex();
  return index.likedUrns
    .map((urn) => index.tracksByUrn[urn])
    .filter((track): track is Track => Boolean(track));
}

export async function getOfflineTracksByUrns(urns: string[]) {
  const index = await loadIndex();
  return urns
    .map((urn) => index.tracksByUrn[urn])
    .filter((track): track is Track => Boolean(track));
}

export async function getOfflineIndexUpdatedAt() {
  const index = await loadIndex();
  return index.updatedAt;
}

export async function rememberFollowingTracks(tracks: Track[]) {
  if (tracks.length === 0) return;
  const index = await loadIndex();
  for (const track of tracks) {
    if (!track?.urn) continue;
    index.tracksByUrn[track.urn] = cloneTrack(track);
  }
  index.followingUrns = tracks.slice(0, FOLLOWING_TRACKS_LIMIT).map((t) => t.urn);
  schedulePersist();
}

export async function getOfflineFollowingTracks() {
  const index = await loadIndex();
  return index.followingUrns
    .map((urn) => index.tracksByUrn[urn])
    .filter((track): track is Track => Boolean(track));
}

export async function rememberRecentlyPlayed(track: Track) {
  if (!track?.urn) return;
  const index = await loadIndex();
  index.tracksByUrn[track.urn] = cloneTrack(track);
  // Prepend, dedupe, trim to limit
  const filtered = index.recentlyPlayedUrns.filter((u) => u !== track.urn);
  index.recentlyPlayedUrns = [track.urn, ...filtered].slice(0, RECENTLY_PLAYED_LIMIT);
  schedulePersist();
}

export async function getRecentlyPlayed() {
  const index = await loadIndex();
  return index.recentlyPlayedUrns
    .map((urn) => index.tracksByUrn[urn])
    .filter((track): track is Track => Boolean(track));
}

/* ── Lyrics cache ──────────────────────────────────────────── */

/** Save lyrics for a track URN. Pass the full LyricsResult. */
export async function rememberLyrics(trackUrn: string, result: LyricsResult): Promise<void> {
  if (!trackUrn || (!result.synced?.length && !result.plain)) return;
  const index = await loadIndex();
  index.lyricsByUrn[trackUrn] = {
    lines: result.synced ?? null,
    plain: result.plain,
    source: result.source,
    cachedAt: Date.now(),
  };
  // Evict oldest entries if over limit
  const entries = Object.entries(index.lyricsByUrn);
  if (entries.length > LYRICS_CACHE_LIMIT) {
    entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const toDelete = entries.slice(0, entries.length - LYRICS_CACHE_LIMIT);
    for (const [urn] of toDelete) delete index.lyricsByUrn[urn];
  }
  schedulePersist();
}

/** Get cached lyrics for a track URN, or null if not cached. */
export async function getOfflineLyrics(trackUrn: string): Promise<LyricsResult | null> {
  if (!trackUrn) return null;
  const index = await loadIndex();
  const cached = index.lyricsByUrn[trackUrn];
  if (!cached) return null;
  return {
    synced: cached.lines,
    plain: cached.plain,
    source: cached.source,
    language: null,
  };
}
