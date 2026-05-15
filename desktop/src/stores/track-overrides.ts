/**
 * Persistent store for custom track title/artist overrides.
 * Used to fix incorrect metadata so lyrics search finds the right result.
 * Keyed by track URN, saved to disk via tauriStorage.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { tauriStorage } from '../lib/tauri-storage';

export interface TrackOverride {
  title?: string;
  artist?: string;
}

interface TrackOverridesState {
  overrides: Record<string, TrackOverride>;
  setOverride: (urn: string, override: TrackOverride) => void;
  clearOverride: (urn: string) => void;
  getOverride: (urn: string) => TrackOverride | undefined;
}

export const useTrackOverridesStore = create<TrackOverridesState>()(
  persist(
    (set, get) => ({
      overrides: {},
      setOverride: (urn, override) =>
        set((s) => ({ overrides: { ...s.overrides, [urn]: override } })),
      clearOverride: (urn) =>
        set((s) => {
          const next = { ...s.overrides };
          delete next[urn];
          return { overrides: next };
        }),
      getOverride: (urn) => get().overrides[urn],
    }),
    {
      name: '__sc_track_overrides_',
      storage: createJSONStorage(() => tauriStorage),
    },
  ),
);

/** Returns override title/artist falling back to track fields */
export function resolveTrackMeta(
  urn: string,
  fallbackTitle: string,
  fallbackArtist: string,
): { title: string; artist: string } {
  const ov = useTrackOverridesStore.getState().getOverride(urn);
  return {
    title: ov?.title || fallbackTitle,
    artist: ov?.artist || fallbackArtist,
  };
}
