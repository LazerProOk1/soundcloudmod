import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import i18n from '../i18n';
import type { Track } from '../stores/player';
import { usePlayerStore } from '../stores/player';
import { useSettingsStore } from '../stores/settings';
import {
  api,
  buildStorageUrls,
  getSessionId,
  resolveTrackFromStreaming,
  streamFallbackUrls,
} from './api';
import { proxiedAssetUrl } from './asset-url';
import {
  enforceAudioCacheLimit,
  ensureTrackCached,
  getCacheInfo,
  type TrackCacheInfo,
} from './cache';
import { trackedInvoke as invoke } from './diagnostics';
import { isUrnDisliked } from './dislikes';
import { recordEvent } from './events';
import { art } from './formatters';
import { rememberRecentlyPlayed, rememberTracks } from './offline-index';
import { getUrnCluster, recordClusterFeedback } from './recsFeedback';
import { getArtistDisplay, getDisplayTitle } from './track-display';

const SKIP_THRESHOLD_SEC = 30;
/** Минимум, чтобы засчитать «прослушано полностью» для коротких треков (50% длительности). */
const FULL_PLAY_RATIO = 0.5;

/* ── Audio engine state ──────────────────────────────────────── */

let currentUrn: string | null = null;
let hasTrack = false;
let fallbackDuration = 0;
let cachedTime = 0;
let cachedTimeWallMs = 0; // performance.now() when cachedTime was last set by a tick
let cachedPlaybackRate = 1.0; // effective speed sent to Rust (rate * pitch multiplier)
let cachedDuration = 0;
let loadGen = 0;
let lastEndedUrn: string | null = null;
/** Ignore audio:ended events until this timestamp (set on seek to prevent spurious next()). */
let seekGuardUntilMs = 0;
/** Wall-clock time of the last seek operation. */
let lastSeekWallMs = 0;
/** Track position at the last seek (seconds). */
let lastSeekPosition = 0;
const listeners = new Set<() => void>();
const API_PREVIEW_DURATION_MS = 30_000;

/** Stored Tauri event unlisten functions — called on HMR dispose to prevent duplicate listeners. */
const tauriUnlisteners: Array<() => void> = [];
/** Timer ID for the deferred media-position update after a seek. */
let seekPositionTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Crossfade state ─────────────────────────────────────────── */

/** When crossfade fade-in is active, this is the rAF id. */
let fadeInRafId: number | null = null;
/** True while a crossfade fade-out is in progress (prevents volume conflicts). */
let crossfading = false;

function applyVolume(targetVolume: number) {
  invoke('audio_set_volume', { volume: targetVolume }).catch(() => {});
}

/** Animate volume from `from` → `to` over `durationMs` ms, then call `onDone`. */
function animateVolume(from: number, to: number, durationMs: number, onDone?: () => void) {
  const startMs = performance.now();
  const diff = to - from;

  if (fadeInRafId !== null) {
    cancelAnimationFrame(fadeInRafId);
    fadeInRafId = null;
  }

  const step = () => {
    const elapsed = performance.now() - startMs;
    const t = Math.min(1, elapsed / durationMs);
    applyVolume(from + diff * t);
    if (t < 1) {
      fadeInRafId = requestAnimationFrame(step);
    } else {
      fadeInRafId = null;
      onDone?.();
    }
  };
  fadeInRafId = requestAnimationFrame(step);
}

function notify() {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Returns the current playback position in seconds, interpolated between
 *  Rust tick events so the value is smooth at any frame rate and correct
 *  at any playback speed. */
export function getCurrentTime(): number {
  const elapsedMs = performance.now() - cachedTimeWallMs;
  return cachedTime + (elapsedMs / 1000) * cachedPlaybackRate;
}

export function getDuration(): number {
  return cachedDuration;
}

/** Returns current position floored to whole seconds.
 *  Use this as a `useSyncExternalStore` snapshot instead of
 *  `() => Math.floor(getCurrentTime())` — that inline function uses
 *  `performance.now()` and can return different values on consecutive
 *  React calls within the same render, causing an infinite loop. */
export function getAudioSecond(): number {
  return Math.floor(cachedTime);
}

export function seek(seconds: number) {
  if (!hasTrack) return;

  // Clamp: never seek past the end — rodio fires audio:ended immediately if position ≥ duration,
  // which would spuriously advance to the next track.
  const clamped =
    cachedDuration > 0.2 ? Math.min(seconds, cachedDuration - 0.15) : Math.max(0, seconds);

  // Reset any in-progress crossfade so volume is restored after manual seek.
  if (crossfading || fadeInRafId !== null) {
    crossfading = false;
    if (fadeInRafId !== null) {
      cancelAnimationFrame(fadeInRafId);
      fadeInRafId = null;
    }
    applyVolume(usePlayerStore.getState().volume);
  }

  // Guard: ignore audio:ended for 800ms after seek — Rodio can emit ended mid-seek.
  // Extended guard: store seek position so audio:ended listener can reject events
  // that fire too early relative to the expected remaining playtime.
  seekGuardUntilMs = performance.now() + 800;
  lastSeekWallMs = performance.now();
  lastSeekPosition = clamped;

  invoke('audio_seek', { position: clamped }).catch(console.error);
  cachedTime = clamped;
  cachedTimeWallMs = performance.now();
  notify();
  // Debounce the media-position update so rapid scrubbing doesn't queue many IPC calls.
  if (seekPositionTimer !== null) clearTimeout(seekPositionTimer);
  seekPositionTimer = setTimeout(() => {
    seekPositionTimer = null;
    updateMediaPosition();
  }, 150);
}

export function handlePrev() {
  if (getCurrentTime() > 3) {
    seek(0);
  } else {
    usePlayerStore.getState().prev();
  }
}

/* ── Native audio control ────────────────────────────────────── */

function stopTrack() {
  invoke('audio_stop').catch(console.error);
  hasTrack = false;
  cachedTime = 0;
}

export async function switchAudioDevice(deviceName: string | null, manual = false) {
  if (manual) {
    await invoke('audio_set_follow_default_output', { follow: deviceName == null });
  }

  await invoke('audio_switch_device', { deviceName });
}

/** Reload the current track on new audio device, preserving position */
export async function reloadCurrentTrack() {
  const track = usePlayerStore.getState().currentTrack;
  if (!track) return;
  const wasPlaying = usePlayerStore.getState().isPlaying;
  const pos = cachedTime;
  await loadTrack(track);
  if (pos > 0) seek(pos);
  if (!wasPlaying) invoke('audio_pause').catch(console.error);
}

function getLoadErrorText(error: unknown): string | null {
  let message: string | null = null;

  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'object' && error) {
    if ('message' in error && typeof error.message === 'string') {
      message = error.message;
    } else if ('error' in error && typeof error.error === 'string') {
      message = error.error;
    }
  }

  if (!message) {
    const fallback = String(error).trim();
    if (fallback && fallback !== '[object Object]') {
      message = fallback;
    }
  }

  if (!message) return null;

  const normalized = message
    .trim()
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Command [^:]+ failed:\s*/i, '');

  const unquoted =
    normalized.startsWith('"') && normalized.endsWith('"')
      ? normalized.slice(1, -1).trim()
      : normalized;

  const sanitized = unquoted
    .replace(/\bhttps?:\/\/[^\s"')\]]+/gi, '')
    .replace(/\bscproxy:\/\/[^\s"')\]]+/gi, '')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~-]+/gi, '$1 [redacted]')
    .replace(
      /\b(oauth_token|token|sig|signature|client_id|x-session-id)=([^&\s]+)/gi,
      '$1=[redacted]',
    )
    .replace(/\s+\bfrom\b\s*(?=$|[):;,.])/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([):;,.])/g, '$1')
    .trim();

  return sanitized || null;
}

type TrackMetadataPatch = Partial<Track> & {
  full_duration?: number;
};

function getResolvedDurationMs(track: {
  duration?: number;
  full_duration?: number;
}): number | null {
  if (typeof track.full_duration === 'number' && track.full_duration > 0) {
    return track.full_duration;
  }
  if (typeof track.duration === 'number' && track.duration > 0) {
    return track.duration;
  }
  return null;
}

function getPreviewResolveUrl(track: Pick<Track, 'duration' | 'permalink_url'>): string | null {
  if (track.duration !== API_PREVIEW_DURATION_MS || !track.permalink_url) {
    return null;
  }

  try {
    const url = new URL(track.permalink_url);
    return url.hostname.endsWith('soundcloud.com') ? url.toString() : null;
  } catch {
    return null;
  }
}

function mergeTrackMetadata(base: Track, patch: TrackMetadataPatch): Track {
  const resolvedDuration = getResolvedDurationMs(patch);

  return {
    ...base,
    ...patch,
    duration:
      resolvedDuration == null ||
      (resolvedDuration === API_PREVIEW_DURATION_MS && base.duration > API_PREVIEW_DURATION_MS)
        ? base.duration
        : resolvedDuration,
    permalink_url: patch.permalink_url ?? base.permalink_url,
    user: patch.user ? { ...base.user, ...patch.user } : base.user,
  };
}

function commitTrackMetadata(track: Track) {
  usePlayerStore.getState().replaceTrackMetadata(track);
  void rememberTracks([track]);

  if (useSettingsStore.getState().cacheListenedTracks) {
    void rememberRecentlyPlayed(track);
    // Warm the permanent image cache by requesting the artwork URL via the proxy
    const artworkUrl = track.artwork_url ?? track.user?.avatar_url;
    if (artworkUrl) {
      const cached = proxiedAssetUrl(art(artworkUrl));
      if (cached) {
        const img = new Image();
        img.src = cached;
      }
    }
  }

  if (currentUrn !== track.urn) return;

  if (track.duration <= 0) {
    updateMetadata(track);
    return;
  }

  const durationSecs = track.duration / 1000;
  fallbackDuration = durationSecs;
  cachedDuration = durationSecs;
  updateMetadata(track, durationSecs);
  notify();
}

async function fetchFreshTrackMetadata(track: Track): Promise<Track> {
  try {
    const freshTrack = await api<Track>(`/tracks/${encodeURIComponent(track.urn)}`, {
      silent: true,
    });
    return mergeTrackMetadata(track, freshTrack);
  } catch (error) {
    console.warn('[Audio] Failed to hydrate track metadata:', error);
    return track;
  }
}

async function resolveTrackMetadata(track: Track): Promise<Track> {
  const resolveUrl = getPreviewResolveUrl(track);
  if (!resolveUrl) return track;

  try {
    const resolvedTrack = await resolveTrackFromStreaming(resolveUrl);
    return mergeTrackMetadata(track, resolvedTrack);
  } catch (error) {
    console.warn('[Audio] Failed to resolve preview duration:', error);
    return track;
  }
}

async function loadTrack(track: Track) {
  const gen = ++loadGen;
  stopTrack();
  currentUrn = track.urn;
  const urn = track.urn;

  // Reset seek guards on new track load
  seekGuardUntilMs = 0;
  lastSeekWallMs = 0;
  lastSeekPosition = 0;

  void hydrateTrackMetadata(track, gen);

  fallbackDuration = track.duration / 1000;
  cachedDuration = fallbackDuration;
  cachedTime = 0;
  usePlayerStore.setState({ downloadProgress: null });
  usePlayerStore.getState().setPlaybackTransport(null, null);
  notify();

  // Sync EQ state to Rust
  const { eqEnabled, eqGains, normalizeVolume } = useSettingsStore.getState();
  invoke('audio_set_eq', { enabled: eqEnabled, gains: eqGains }).catch(console.error);
  invoke('audio_set_normalization', { enabled: normalizeVolume }).catch(console.error);

  // Sync volume + playback rate (pitch is folded into the speed value sent to Rust)
  // If a crossfade is in progress, start the new track silent so the fade-in can
  // ramp up from 0 — otherwise loadTrack would reset the faded-out volume back to
  // user volume and the first audio buffer would play at full level.
  const _cfDuration = useSettingsStore.getState().crossfadeDuration;
  const startVolume = crossfading && _cfDuration > 0 ? 0 : usePlayerStore.getState().volume;
  invoke('audio_set_volume', { volume: startVolume }).catch(console.error);
  const initialRate = getEffectivePlaybackRate();
  cachedPlaybackRate = initialRate;
  cachedTime = 0;
  cachedTimeWallMs = performance.now();
  invoke('audio_set_playback_rate', { rate: initialRate }).catch(console.error);

  try {
    const highQualityStreaming = useSettingsStore.getState().highQualityStreaming;

    // Strategy 1: Cache hit — instant
    const cached = await getCacheInfo(urn);
    if (cached?.path) {
      if (gen !== loadGen) return;
      usePlayerStore.getState().setPlaybackTransport(cached.quality, cached.source);
      const loadResult = await invoke<{ duration_secs: number | null }>('audio_load_file', {
        path: cached.path,
        cacheKey: urn,
        startPaused: !usePlayerStore.getState().isPlaying,
      });
      if (gen !== loadGen) return;
      if (loadResult?.duration_secs) {
        fallbackDuration = loadResult.duration_secs;
        cachedDuration = loadResult.duration_secs;
        updateMetadata(track, loadResult.duration_secs);
        notify();
      }
      afterLoad(track, gen);
      return;
    }

    // Strategy 2: Download full track to cache — Rust picks storage/API internally
    usePlayerStore.setState({ downloadProgress: 0 });

    let cachedInfo: TrackCacheInfo;
    try {
      cachedInfo = await ensureTrackCached(urn, highQualityStreaming);
    } catch (error) {
      if (!highQualityStreaming) throw error;
      console.warn('[Audio] HQ load failed, retrying without hq:', error);
      cachedInfo = await ensureTrackCached(urn, false);
    }

    if (gen !== loadGen) return;
    usePlayerStore.setState({ downloadProgress: null });
    usePlayerStore.getState().setPlaybackTransport(cachedInfo.quality, cachedInfo.source);

    const loadResult = await invoke<{ duration_secs: number | null }>('audio_load_file', {
      path: cachedInfo.path,
      cacheKey: urn,
      startPaused: !usePlayerStore.getState().isPlaying,
    });
    if (loadResult?.duration_secs) {
      fallbackDuration = loadResult.duration_secs;
      cachedDuration = loadResult.duration_secs;
      updateMetadata(track, loadResult.duration_secs);
      notify();
    }
    void enforceAudioCacheLimit().catch(console.error);

    if (gen !== loadGen) return;
    afterLoad(track, gen);
  } catch (e) {
    console.error('[Audio] Load failed:', e);
    usePlayerStore.setState({ downloadProgress: null });
    usePlayerStore.getState().setPlaybackTransport(null, null);
    if (gen !== loadGen) return;
    const errorText = getLoadErrorText(e);
    toast.error(i18n.t('track.loadError'), {
      description: errorText ? `${track.title}: ${errorText}` : track.title,
    });
    usePlayerStore.getState().pause();
  }
}

function afterLoad(track: Track, gen: number) {
  if (gen !== loadGen) {
    invoke('audio_stop').catch(console.error);
    return;
  }
  hasTrack = true;

  const historyTrack =
    usePlayerStore.getState().currentTrack?.urn === track.urn
      ? usePlayerStore.getState().currentTrack
      : track;

  // Record to listening history (fire-and-forget), skip on repeat-one (same track looping)
  if (historyTrack?.urn && historyTrack.title && usePlayerStore.getState().repeat !== 'one') {
    api('/history', {
      method: 'POST',
      silent: true,
      body: JSON.stringify({
        scTrackId: historyTrack.urn,
        title: historyTrack.title,
        artistName: historyTrack.user?.username || '',
        artistUrn: historyTrack.user?.urn || null,
        artworkUrl: historyTrack.artwork_url || null,
        duration: historyTrack.duration || 0,
      }),
    }).catch(() => {});
  }

  const isPlaying = usePlayerStore.getState().isPlaying;

  // ── Crossfade fade-in ───────────────────────────────────────
  // applyVolume(0) MUST be called before audio_play, otherwise the first
  // audio buffer fires at user volume before the IPC set-volume arrives.
  const crossfadeSecs = useSettingsStore.getState().crossfadeDuration;
  if (crossfading && crossfadeSecs > 0 && isPlaying) {
    const userVolume = usePlayerStore.getState().volume;
    applyVolume(0);
    invoke('audio_play').catch(console.error);
    animateVolume(0, userVolume, crossfadeSecs * 1000, () => {
      crossfading = false;
      // Restore exact user volume in case float drift occurred
      applyVolume(usePlayerStore.getState().volume);
    });
  } else {
    crossfading = false;
    invoke(isPlaying ? 'audio_play' : 'audio_pause').catch(console.error);
  }
  updatePlaybackState(isPlaying);
  updateMediaPosition();
  preloadQueue();
}

async function hydrateTrackMetadata(track: Track, gen: number) {
  let nextTrack = await fetchFreshTrackMetadata(track);
  if (gen !== loadGen || currentUrn !== track.urn) return;

  nextTrack = await resolveTrackMetadata(nextTrack);
  if (gen !== loadGen || currentUrn !== track.urn) return;
  commitTrackMetadata(nextTrack);
}

function handleTrackEnd() {
  const state = usePlayerStore.getState();
  if (state.repeat === 'one') {
    // rodio sink is empty after track ends — must reload
    if (state.currentTrack) void loadTrack(state.currentTrack);
  } else {
    const { queue, queueIndex } = state;
    const isLast = queueIndex >= queue.length - 1;
    if (isLast && state.repeat === 'off' && queue.length > 0) {
      void autoplayRelated(queue[queueIndex]);
    } else {
      // Clear currentUrn so subscriber detects change even if next track has same URN
      currentUrn = null;
      usePlayerStore.getState().next();
    }
  }
}

/* ── Tauri event listeners ───────────────────────────────────── */

/** Register a Tauri event listener and store its unlisten function for cleanup. */
function tauriListen<T>(event: string, handler: (e: { payload: T }) => void): void {
  listen<T>(event, handler)
    .then((unlisten) => tauriUnlisteners.push(unlisten))
    .catch(console.error);
}

tauriListen<number>('audio:tick', (event) => {
  cachedTime = event.payload;
  cachedTimeWallMs = performance.now();
  if (cachedDuration <= 0) cachedDuration = fallbackDuration;
  notify();

  // ── Crossfade fade-out near track end ──────────────────────
  const crossfadeSecs = useSettingsStore.getState().crossfadeDuration;
  if (crossfadeSecs > 0 && !crossfading && cachedDuration > 0) {
    const remaining = cachedDuration - cachedTime;
    if (remaining > 0 && remaining <= crossfadeSecs) {
      crossfading = true;
      const userVolume = usePlayerStore.getState().volume;
      const fadeDurationMs = remaining * 1000;
      animateVolume(userVolume, 0, fadeDurationMs);
    }
  }
});

tauriListen<{ urn: string; progress: number }>('track:download-progress', (event) => {
  const { urn, progress } = event.payload;
  if (urn === currentUrn) {
    usePlayerStore.setState({ downloadProgress: progress });
  }
});

tauriListen<void>('audio:ended', () => {
  // Suppress spurious ended events fired by Rodio during/immediately after a seek
  if (performance.now() < seekGuardUntilMs) return;

  // Extended seek guard: block audio:ended if it fires significantly earlier than
  // the expected remaining playtime. E.g. seeking to 5s before end → guard 4s.
  // This catches Rodio emitting ended 1-2s after seek instead of waiting.
  if (lastSeekWallMs > 0 && cachedDuration > 0) {
    const expectedRemainingMs = (cachedDuration - lastSeekPosition) * 1000;
    const elapsedSinceSeekMs = performance.now() - lastSeekWallMs;
    // If ended fires >1.5s before the expected end, it's a spurious Rodio event
    if (elapsedSinceSeekMs < expectedRemainingMs - 1500) return;
  }

  if (currentUrn) {
    // Засчитываем full_play только если трек реально игрался: либо ≥30s,
    // либо проиграно ≥50% длительности (для коротких треков). Иначе это
    // зависшая загрузка / зеро-длительность баг — не отправляем.
    const playedEnough =
      cachedTime >= SKIP_THRESHOLD_SEC ||
      (cachedDuration > 0 && cachedTime >= cachedDuration * FULL_PLAY_RATIO);
    if (playedEnough) {
      const positionPct = cachedDuration > 0 ? Math.min(1, cachedTime / cachedDuration) : undefined;
      recordEvent('full_play', currentUrn, positionPct);
      const cluster = getUrnCluster(currentUrn);
      if (cluster) recordClusterFeedback(cluster, 'complete');
    }
    lastEndedUrn = currentUrn;
  }
  hasTrack = false;
  handleTrackEnd();
});

/* ── Store subscriber ────────────────────────────────────────── */

usePlayerStore.subscribe((state, prev) => {
  const nextUrn = state.currentTrack?.urn ?? null;
  const trackChanged = nextUrn !== currentUrn;
  const playToggled = state.isPlaying !== prev.isPlaying;

  if (trackChanged) {
    const previousUrn = currentUrn;
    const previousTime = cachedTime;
    const previousHadTrack = hasTrack;

    if (
      previousUrn &&
      previousHadTrack &&
      previousTime < SKIP_THRESHOLD_SEC &&
      previousUrn !== lastEndedUrn
    ) {
      const previousDuration = cachedDuration > 0 ? cachedDuration : fallbackDuration;
      const positionPct = previousDuration > 0 ? previousTime / previousDuration : undefined;
      recordEvent('skip', previousUrn, positionPct);
    }
    lastEndedUrn = null;

    if (state.currentTrack) {
      // Автоскип дизлайкнутых треков: пропускаем без загрузки/плэя.
      if (isUrnDisliked(state.currentTrack.urn)) {
        currentUrn = null;
        fallbackDuration = 0;
        cachedDuration = 0;
        cachedTime = 0;
        hasTrack = false;
        usePlayerStore.getState().setPlaybackTransport(null, null);
        notify();
        usePlayerStore.getState().next();
        return;
      }
      updateMetadata(state.currentTrack);
      void loadTrack(state.currentTrack);
    } else {
      stopTrack();
      currentUrn = null;
      fallbackDuration = 0;
      cachedDuration = 0;
      usePlayerStore.getState().setPlaybackTransport(null, null);
      notify();
    }
    return;
  }

  if (playToggled && !trackChanged) {
    if (state.isPlaying) {
      if (!hasTrack && state.currentTrack) {
        void loadTrack(state.currentTrack);
      } else {
        invoke('audio_play').catch(console.error);
      }
    } else {
      invoke('audio_pause').catch(console.error);
    }
    updatePlaybackState(state.isPlaying);
  }

  if (state.volume !== prev.volume) {
    invoke('audio_set_volume', { volume: state.volume }).catch(console.error);
  }

  if (
    state.playbackRate !== prev.playbackRate ||
    state.pitchSemitones !== prev.pitchSemitones ||
    state.pitchControlMode !== prev.pitchControlMode
  ) {
    const rate = getEffectivePlaybackRate();
    cachedTime = getCurrentTime(); // capture interpolated position before rate changes
    cachedTimeWallMs = performance.now();
    cachedPlaybackRate = rate;
    invoke('audio_set_playback_rate', { rate }).catch(console.error);
  }
});

/** Combine playback rate and (manual) pitch into a single Rust-side speed value.
 *  Rust uses rodio's `set_speed` which couples tempo+pitch — so manual pitch is
 *  applied as a multiplier on top of the user's rate.
 */
function getEffectivePlaybackRate(): number {
  const { playbackRate, pitchControlMode, pitchSemitones } = usePlayerStore.getState();
  if (pitchControlMode === 'manual' && Math.abs(pitchSemitones) > 0.001) {
    return playbackRate * 2 ** (pitchSemitones / 12);
  }
  return playbackRate;
}

/* ── EQ settings subscriber ──────────────────────────────────── */

useSettingsStore.subscribe((state, prev) => {
  if (state.eqEnabled !== prev.eqEnabled || state.eqGains !== prev.eqGains) {
    invoke('audio_set_eq', { enabled: state.eqEnabled, gains: state.eqGains }).catch(console.error);
  }

  if (state.normalizeVolume !== prev.normalizeVolume) {
    invoke('audio_set_normalization', { enabled: state.normalizeVolume }).catch(console.error);
    if (usePlayerStore.getState().currentTrack) {
      void reloadCurrentTrack();
    }
  }
});

/* ── Native Media Controls (souvlaki: MPRIS/SMTC) ───────────── */

function updateMetadata(track: Track, durationSecs?: number) {
  const coverUrl = art(track.artwork_url, 't500x500') || undefined;
  const display = getArtistDisplay(track);
  const title = getDisplayTitle(track);
  invoke('audio_set_metadata', {
    title,
    artist: display.primary,
    coverUrl: coverUrl || null,
    durationSecs: durationSecs ?? track.duration / 1000,
  }).catch(console.error);
}

function updatePlaybackState(playing: boolean) {
  invoke('audio_set_playback_state', { playing }).catch(console.error);
}

function updateMediaPosition() {
  const pos = getCurrentTime();
  if (pos > 0) {
    invoke('audio_set_media_position', { position: pos }).catch(console.error);
  }
}

// Listen for media control events from souvlaki (MPRIS/SMTC)
tauriListen<void>('media:play', () => usePlayerStore.getState().resume());
tauriListen<void>('media:pause', () => usePlayerStore.getState().pause());
tauriListen<void>('media:toggle', () => usePlayerStore.getState().togglePlay());
tauriListen<void>('media:next', () => usePlayerStore.getState().next());
tauriListen<void>('media:prev', () => handlePrev());
tauriListen<number>('media:seek', (e) => seek(e.payload));
tauriListen<number>('media:seek-relative', (e) => {
  const offset = e.payload;
  if (offset > 0) {
    seek(Math.min(getCurrentTime() + offset, getDuration()));
  } else {
    seek(Math.max(getCurrentTime() + offset, 0));
  }
});

/* ── HMR cleanup — prevents duplicate listeners on hot reload ── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const unlisten of tauriUnlisteners) unlisten();
    tauriUnlisteners.length = 0;
    if (seekPositionTimer !== null) {
      clearTimeout(seekPositionTimer);
      seekPositionTimer = null;
    }
  });
}

/* ── Autoplay ────────────────────────────────────────────────── */

let autoplayLoading = false;

async function autoplayRelated(lastTrack: Track) {
  if (autoplayLoading) return;
  autoplayLoading = true;

  try {
    const { queue } = usePlayerStore.getState();
    const existingUrns = new Set(queue.map((t) => t.urn));
    const res = await api<{ collection: Track[] }>(
      `/tracks/${encodeURIComponent(lastTrack.urn)}/related?limit=20`,
    );
    const fresh = res.collection.filter((t) => !existingUrns.has(t.urn));
    if (fresh.length === 0) {
      usePlayerStore.getState().pause();
      return;
    }

    usePlayerStore.getState().addToQueue(fresh);
    usePlayerStore.getState().next();
  } catch (e) {
    console.error('Autoplay related failed:', e);
    usePlayerStore.getState().pause();
  } finally {
    autoplayLoading = false;
  }
}

/* ── Preloading ──────────────────────────────────────────────── */

let preloadTimer: ReturnType<typeof setTimeout> | null = null;

export function preloadTrack(urn: string) {
  if (preloadTimer) clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => {
    const sessionId = getSessionId();
    invoke('track_preload', {
      entries: [
        { urn, urls: streamFallbackUrls(urn), storageUrls: buildStorageUrls(urn), sessionId },
      ],
    }).catch(console.error);
  }, 150);
}

export function preloadQueue() {
  const { queue, queueIndex } = usePlayerStore.getState();
  const entries: Array<{
    urn: string;
    urls: string[];
    storageUrls: string[];
    sessionId: string | null;
  }> = [];
  const upcomingTracks: Track[] = [];
  const sessionId = getSessionId();

  for (let i = 1; i <= 5; i++) {
    const idx = queueIndex + i;
    if (idx < queue.length) {
      const track = queue[idx];
      entries.push({
        urn: track.urn,
        urls: streamFallbackUrls(track.urn),
        storageUrls: buildStorageUrls(track.urn),
        sessionId,
      });
      upcomingTracks.push(track);
    }
  }

  if (entries.length > 0) {
    invoke('track_preload', { entries }).catch(console.error);
    // Fetch lyrics for upcoming tracks in background (low concurrency — audio has priority)
    void import('./lyrics-fetch').then(({ cacheLyricsForTracks }) =>
      cacheLyricsForTracks(upcomingTracks, 2),
    );
  }
}

usePlayerStore.subscribe((state, prev) => {
  if (state.queueIndex !== prev.queueIndex || state.queue !== prev.queue) {
    preloadQueue();
  }
});
