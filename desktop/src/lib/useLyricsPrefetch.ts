import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../stores/player';
import { fetchLyricsForTrack, lyricsQueryKey } from './lyrics-fetch';

/**
 * Starts a background lyrics fetch whenever the current track changes.
 * By the time the user opens the lyrics panel, the data is already cached
 * by TanStack Query — so the panel opens instantly with no loading spinner.
 *
 * Mount this hook once in AppShell (always rendered while logged in).
 */
export function useLyricsPrefetch() {
  const qc = useQueryClient();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentTrack) return;

    const track = currentTrack;
    const key = lyricsQueryKey(track);

    // If already in cache (staleTime: Infinity means it never expires), skip
    const existing = qc.getQueryState(key);
    if (existing?.status === 'success') return;

    // Small delay to avoid firing on rapid skips / queue reshuffles
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void qc.prefetchQuery({
        queryKey: key,
        queryFn: () => fetchLyricsForTrack(track),
        staleTime: Number.POSITIVE_INFINITY,
      });
    }, 1_500);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [currentTrack?.urn, qc]);
}
