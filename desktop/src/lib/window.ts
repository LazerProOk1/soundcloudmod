import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';

export async function toggleWindowFullscreen() {
  const currentWindow = getCurrentWindow();
  const isFullscreen = await currentWindow.isFullscreen();
  await currentWindow.setFullscreen(!isFullscreen);
}

// ── Mini-player ───────────────────────────────────────────────

const MINI_W = 360;
const MINI_H = 96;
const FULL_MIN_W = 800;
const FULL_MIN_H = 470;

/** Stores the window size before entering mini mode so we can restore it. */
let savedSize: { width: number; height: number } | null = null;

export async function enterMiniPlayer(): Promise<void> {
  const win = getCurrentWindow();

  // Save current logical size before shrinking
  const size = await win.outerSize();
  const scale = await win.scaleFactor();
  savedSize = {
    width: Math.round(size.width / scale),
    height: Math.round(size.height / scale),
  };

  // Remove minimum size constraints so we can go smaller than the default 800×470
  await win.setMinSize(new LogicalSize(MINI_W, MINI_H));
  await win.setSize(new LogicalSize(MINI_W, MINI_H));
  await win.setAlwaysOnTop(true);
  await win.setResizable(false);
  await win.center();
}

export async function exitMiniPlayer(): Promise<void> {
  const win = getCurrentWindow();

  await win.setAlwaysOnTop(false);
  await win.setResizable(true);
  await win.setMinSize(new LogicalSize(FULL_MIN_W, FULL_MIN_H));

  const { width, height } = savedSize ?? { width: 1200, height: 800 };
  await win.setSize(new LogicalSize(width, height));
  await win.center();
  savedSize = null;
}
