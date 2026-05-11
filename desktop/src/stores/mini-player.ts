import { create } from 'zustand';
import { enterMiniPlayer, exitMiniPlayer } from '../lib/window';

interface MiniPlayerState {
  isMini: boolean;
  entering: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
}

export const useMiniPlayerStore = create<MiniPlayerState>()((set, get) => ({
  isMini: false,
  entering: false,

  enter: async () => {
    if (get().isMini || get().entering) return;
    set({ entering: true });
    try {
      await enterMiniPlayer();
      set({ isMini: true });
    } finally {
      set({ entering: false });
    }
  },

  exit: async () => {
    if (!get().isMini) return;
    await exitMiniPlayer();
    set({ isMini: false });
  },
}));
