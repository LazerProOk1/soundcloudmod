import { fetch } from '@tauri-apps/plugin-http';
import { type LyricsResult, parseLRC } from './lyrics';

const BASE = 'https://lrclib.net/api';

interface LrclibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

function toResult(track: LrclibTrack | null): LyricsResult | null {
  if (!track) return null;
  const synced = track.syncedLyrics ? parseLRC(track.syncedLyrics) : null;
  return {
    plain: track.plainLyrics ?? null,
    synced: synced && synced.length > 0 ? synced : null,
    source: 'lrclib',
    language: null,
  };
}

/** Exact-match lookup (best for known artist/title/duration). Returns null on miss or error. */
export async function lrclibGet(
  artist: string,
  title: string,
  durationSec?: number,
): Promise<LyricsResult | null> {
  try {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    if (durationSec != null && durationSec > 0) {
      params.set('duration', String(Math.round(durationSec)));
    }
    const res = await fetch(`${BASE}/get?${params}`, {
      method: 'GET',
      headers: { 'Lrclib-Client': 'SoundCloud-Desktop/1.0' },
      connectTimeout: 5000,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LrclibTrack;
    return toResult(data);
  } catch {
    return null;
  }
}

/** Fuzzy search — returns best hit (synced preferred) or null.
 *  When durationSec is provided, candidates outside ±20 s are deprioritised
 *  so we don't match a cover/karaoke version with wrong lyrics. */
export async function lrclibSearch(
  artist: string,
  title: string,
  durationSec?: number,
): Promise<LyricsResult | null> {
  try {
    const q = `${artist} ${title}`.trim();
    const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`, {
      method: 'GET',
      headers: { 'Lrclib-Client': 'SoundCloud-Desktop/1.0' },
      connectTimeout: 5000,
    });
    if (!res.ok) return null;
    const list = (await res.json()) as LrclibTrack[];
    if (!list.length) return null;

    // If we know the track duration, filter to candidates within ±20 s.
    // This prevents matching a cover/karaoke with a completely different runtime.
    const candidates =
      durationSec != null && durationSec > 0
        ? list.filter((t) => t.duration > 0 && Math.abs(t.duration - durationSec) <= 20)
        : list;

    const pool = candidates.length > 0 ? candidates : list; // fall back if no duration match
    const synced = pool.find((t) => t.syncedLyrics);
    return toResult(synced ?? pool[0]);
  } catch {
    return null;
  }
}
