import { create } from 'zustand';
import { usePlayerStore } from '../stores/player';

interface SleepTimerState {
  /** Unix timestamp (ms) when playback should pause. Null = inactive. */
  endsAt: number | null;
  /** Stop after current track finishes (instead of a fixed time). */
  afterTrack: boolean;

  set: (minutes: number) => void;
  setAfterTrack: () => void;
  cancel: () => void;
}

export const useSleepTimer = create<SleepTimerState>()((set) => ({
  endsAt: null,
  afterTrack: false,

  set: (minutes: number) => {
    set({ endsAt: Date.now() + minutes * 60 * 1000, afterTrack: false });
  },

  setAfterTrack: () => {
    set({ endsAt: null, afterTrack: true });
  },

  cancel: () => {
    set({ endsAt: null, afterTrack: false });
  },
}));

/** Returns remaining seconds, or null when inactive. */
export function getSleepTimerRemaining(): number | null {
  const { endsAt, afterTrack } = useSleepTimer.getState();
  if (afterTrack) return null; // shown separately
  if (!endsAt) return null;
  return Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
}

// ── Tick: check timer every second ────────────────────────────

let tickId: ReturnType<typeof setInterval> | null = null;

function checkTimer() {
  const { endsAt, afterTrack, cancel } = useSleepTimer.getState();

  if (afterTrack) {
    // Wait until the current track ends (handled by subscribeAfterTrack below)
    return;
  }

  if (!endsAt) return;

  if (Date.now() >= endsAt) {
    usePlayerStore.getState().pause();
    cancel();
  }
}

export function initSleepTimer() {
  if (tickId !== null) return;
  tickId = setInterval(checkTimer, 1000);

  // Subscribe to track changes for "after track" mode
  let lastUrn: string | null = usePlayerStore.getState().currentTrack?.urn ?? null;
  usePlayerStore.subscribe((state) => {
    const urn = state.currentTrack?.urn ?? null;
    if (urn !== lastUrn && lastUrn !== null) {
      // Track changed — if afterTrack mode is active, pause now (before the new track plays)
      const { afterTrack, cancel } = useSleepTimer.getState();
      if (afterTrack) {
        usePlayerStore.getState().pause();
        cancel();
      }
    }
    lastUrn = urn;
  });
}
