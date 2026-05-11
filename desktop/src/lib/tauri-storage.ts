import type { StateStorage } from 'zustand/middleware';

/* ── Storage for Zustand persist ────────────────────────────────
 *
 * Primary: localStorage — synchronous, always reliable in WebView2.
 * Tauri's WebView2 persists localStorage in
 *   %LOCALAPPDATA%\com.soundcloud.desktop\EBWebView\...
 * so data survives between app launches automatically.
 *
 * Secondary (async, fire-and-forget): also write a JSON file to
 *   %APPDATA%\com.soundcloud.desktop\<name>.json
 * for human-readable backup / cross-profile portability.        */

const LS_PREFIX = '__sc_store_';

/** Write a backup copy to %APPDATA%\com.soundcloud.desktop\ (best-effort). */
async function writeFileBackup(name: string, value: string): Promise<void> {
  try {
    const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const base = BaseDirectory.AppData;
    // Ensure directory exists first
    await mkdir('.', { baseDir: base, recursive: true }).catch(() => {});
    await writeTextFile(`${name}.json`, value, { baseDir: base });
  } catch {
    // Best-effort only — localStorage already has the data
  }
}

/** Try to read from the file backup (returns null on any failure). */
async function readFileBackup(name: string): Promise<string | null> {
  try {
    const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const base = BaseDirectory.AppData;
    if (await exists(`${name}.json`, { baseDir: base })) {
      return await readTextFile(`${name}.json`, { baseDir: base });
    }
  } catch {
    // ignore
  }
  return null;
}

export const tauriStorage: StateStorage = {
  /** Read: localStorage first (fast), fall back to file backup. */
  getItem: async (name: string): Promise<string | null> => {
    // Fast path: localStorage
    const lsValue = localStorage.getItem(LS_PREFIX + name);
    if (lsValue !== null) return lsValue;

    // Slow path: maybe stored in file from an older version
    const fileValue = await readFileBackup(name);
    if (fileValue !== null) {
      // Migrate to localStorage for next time
      try { localStorage.setItem(LS_PREFIX + name, fileValue); } catch { /* ok */ }
    }
    return fileValue;
  },

  /** Write: localStorage (sync, guaranteed), then file (async, best-effort). */
  setItem: (name: string, value: string): void | Promise<void> => {
    // Synchronous write to localStorage — always succeeds
    try {
      localStorage.setItem(LS_PREFIX + name, value);
    } catch {
      // storage quota exceeded — rare
    }
    // Async backup to file (fire-and-forget, not awaited by Zustand)
    void writeFileBackup(name, value);
  },

  /** Remove from both locations. */
  removeItem: async (name: string): Promise<void> => {
    try { localStorage.removeItem(LS_PREFIX + name); } catch { /* ok */ }
    try {
      const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await remove(`${name}.json`, { baseDir: BaseDirectory.AppData });
    } catch { /* ok if file doesn't exist */ }
  },
};
