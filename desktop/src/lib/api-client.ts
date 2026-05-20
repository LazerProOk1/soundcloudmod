import { fetch } from '@tauri-apps/plugin-http';
import { toast } from 'sonner';
import { useAppStatusStore } from '../stores/app-status';
import { useSettingsStore } from '../stores/settings';
import { API_BASE, BYPASS_API_BASE, DIRECT_SC_API_BASE } from './constants';
import { noteAuthGap, noteRateLimit, noteSuccess } from './auth-recovery';
import { logHttpError, logHttpFailure, trackAsync } from './diagnostics';
import { isHealthy, markHealthy, markUnhealthy } from './host-health';
import { getIsPremium } from './premium-cache';

// ─── Session ────────────────────────────────────────────────

let sessionId: string | null = null;

export function setSessionId(id: string | null) {
  sessionId = id;
}

export function getSessionId() {
  return sessionId;
}

// ─── Error ──────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body}`);
    this.name = 'ApiError';
  }
}

// ─── Global rate-limit guard for direct mode ────────────────
//
// In direct mode every request hits api-v2.soundcloud.com directly.
// SoundCloud enforces strict per-IP rate limits (~10-20 req/s).
// We allow at most DIRECT_CONCURRENCY in-flight requests at once and
// add a small inter-request gap to stay well under the limit.
//
// Proxy mode (api.scdinternal.site) does NOT use a semaphore — the backend
// handles its own concurrency and adding a client-side queue would only
// slow down critical requests like /me while the queue drains.

function makeSemaphore(maxConcurrent: number, gapMs: number) {
  let active = 0;
  let lastStartMs = 0;
  const queue: Array<() => void> = [];

  function release() {
    active--;
    if (queue.length > 0) {
      const next = queue.shift()!;
      const wait = Math.max(0, lastStartMs + gapMs - Date.now());
      setTimeout(() => { lastStartMs = Date.now(); active++; next(); }, wait);
    }
  }

  function acquire(): Promise<void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (active < maxConcurrent) {
          const wait = Math.max(0, lastStartMs + gapMs - Date.now());
          setTimeout(() => { lastStartMs = Date.now(); active++; resolve(); }, wait);
        } else {
          queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  return { acquire, release };
}

const _directSem = makeSemaphore(2, 150); // SoundCloud direct API only

// ─── Host resolution ────────────────────────────────────────

const AUTH_PATHS = ['/auth/'];

function isAuthPath(path: string): boolean {
  return AUTH_PATHS.some((p) => path.startsWith(p));
}

function isDirectMode(): boolean {
  const { apiMode, directOAuthToken } = useSettingsStore.getState();
  return apiMode === 'direct' && directOAuthToken.trim().length > 0;
}

function resolveApiBases(path: string, direct?: boolean): string[] {
  // Direct mode: go straight to SoundCloud, no fallback.
  // Accept the pre-captured `direct` flag to avoid re-reading settings
  // after they may have changed while waiting in the semaphore queue.
  const d = direct ?? (isDirectMode() && !isAuthPath(path));
  if (d && !isAuthPath(path)) {
    return [DIRECT_SC_API_BASE];
  }

  // Auth paths: always try primary API first, BYPASS as fallback.
  // BYPASS host can be independently unavailable and must not block auth.
  if (isAuthPath(path)) {
    return isHealthy(API_BASE) ? [API_BASE, BYPASS_API_BASE] : [BYPASS_API_BASE, API_BASE];
  }

  const bypass = useSettingsStore.getState().bypassWhitelist;
  const premium = getIsPremium();

  // Premium + bypass: white first, regular fallback
  if (bypass && premium) {
    return isHealthy(BYPASS_API_BASE) ? [BYPASS_API_BASE, API_BASE] : [API_BASE];
  }

  // Default: regular only
  return [API_BASE];
}

// ─── Helpers ────────────────────────────────────────────────

// Bypass hosts (white.*) get a shorter probe timeout so a downed bypass
// host doesn't block the entire app for 15 s before falling back.
const BYPASS_TIMEOUT_MS  = 4_000;
const DEFAULT_TIMEOUT_MS = 15_000;

function isBypassUrl(url: string): boolean {
  return url.includes('white.');
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = isBypassUrl(url) ? BYPASS_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);

  // Forward an external AbortSignal (e.g. TanStack Query's cancellation) to our controller
  // so that navigation away from a page aborts the in-flight request immediately.
  const externalSignal = options.signal as AbortSignal | undefined | null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), {
        once: true,
      });
    }
  }

  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  ) as Promise<Response>;
}

function handleApiError(err: ApiError): void {
  if (err.status >= 500) {
    // Deduplicate: same status code reuses the same toast ID
    toast.error(`Server error (${err.status})`, {
      id: `api-server-error-${err.status}`,
      duration: 4000,
    });
  } else if (err.status >= 400 && err.status !== 401) {
    try {
      const parsed = JSON.parse(err.body);
      toast.error(parsed.message || parsed.error || `Error ${err.status}`);
    } catch {
      toast.error(`Error ${err.status}`);
    }
  }
}

// ─── Main API client ────────────────────────────────────────

export interface ApiOptions extends RequestInit {
  /** Suppress the automatic error toast. The error is still thrown to the caller. */
  silent?: boolean;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiOptions = {},
  timeoutMs?: number,
): Promise<T> {
  const { silent, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);

  const direct = isDirectMode();

  // Throttle direct-mode requests through the global semaphore
  // so we never flood api-v2.soundcloud.com and trigger 429s.
  let releaseSlot: (() => void) | null = null;
  if (direct && !isAuthPath(path)) {
    await _directSem.acquire();
    releaseSlot = _directSem.release;
  }

  try {
    return await _apiRequestInner<T>(path, options, timeoutMs, { silent, fetchOptions, headers, direct });
  } finally {
    releaseSlot?.();
  }
}

async function _apiRequestInner<T>(
  path: string,
  _options: ApiOptions,
  timeoutMs: number | undefined,
  ctx: { silent: boolean | undefined; fetchOptions: Omit<ApiOptions, 'silent'>; headers: Headers; direct: boolean },
): Promise<T> {
  const { silent, fetchOptions, headers, direct } = ctx;
  if (direct && !isAuthPath(path)) {
    // Direct SoundCloud mode: use OAuth token instead of scdinternal session
    const { directOAuthToken } = useSettingsStore.getState();
    headers.set('Authorization', `OAuth ${directOAuthToken.trim()}`);
    headers.set('Accept', 'application/json; charset=utf-8');
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'SoundCloud-Android/2024.03.20-release (Android 13)');
    }
  } else {
    // Original mode: Защита от попадания строки "undefined"/"null" в header при апгрейдах формата API.
    if (sessionId && sessionId !== 'undefined' && sessionId !== 'null') {
      headers.set('x-session-id', sessionId);
    }
  }

  if (!headers.has('Content-Type') && fetchOptions.body) headers.set('Content-Type', 'application/json');

  // Pass the already-captured direct flag so resolveApiBases doesn't
  // re-read settings that might have changed while waiting in the semaphore.
  const bases = resolveApiBases(path, direct);
  const method = fetchOptions.method ?? 'GET';
  let lastError: unknown = null;

  const label = `${method.toUpperCase()} ${path}`;

  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    const url = `${base}${path}`;
    try {
      const res = await trackAsync(
        `http:${label}`,
        fetchWithTimeout(url, { ...fetchOptions, headers }, timeoutMs),
      );

      markHealthy(base);
      useAppStatusStore.getState().setBackendReachable(true);

      if (!res.ok) {
        const body = await res.text();
        const err = new ApiError(res.status, body);
        logHttpError(label, res.status, url, body);

        // 429: rate-limit — fail fast, auth-recovery counts hits and triggers
        // silent renewal after 3+ events in 15 s. No toast, no retry.
        if (res.status === 429) {
          noteRateLimit();
          console.warn(`[RateLimit] 429 on ${path} — failing fast`);
          throw err;
        }

        // 401: trigger auth-recovery orchestrator
        if (res.status === 401) {
          if (direct) {
            console.error(`[DirectMode] OAuth token rejected by SoundCloud: ${path}`);
            if (!silent) {
              toast.error('OAuth токен недействителен — обновите его в настройках', {
                id: 'sc-oauth-invalid',
                duration: 8000,
              });
            }
            throw err;
          }
          noteAuthGap();
          console.error(`HTTP ERROR: url: ${path}, `, err);
          throw err;
        }

        // 5xx with more bases to try → mark unhealthy, continue
        if (res.status >= 500 && i < bases.length - 1) {
          markUnhealthy(base);
          lastError = err;
          continue;
        }

        if (!silent) handleApiError(err);
        console.error(`HTTP ERROR: url: ${path}, `, err);
        throw err;
      }

      noteSuccess();
      const ct = res.headers.get('content-type');
      const reply = await (ct?.includes('application/json') ? res.json() : (res.text() as T));

      if (typeof reply === 'string') {
        try {
          return JSON.parse(reply) as T;
        } catch {}
      }

      return reply;
    } catch (error) {
      // Already handled ApiError — rethrow
      if (error instanceof ApiError) throw error;
      // Network error — mark unhealthy, try next
      logHttpFailure(label, url, error);
      markUnhealthy(base);
      lastError = error;
    }
  }

  // Only mark the backend as unreachable for non-auth, non-direct paths.
  // Auth endpoints use a different host (BYPASS) that can be unavailable independently.
  // Direct mode talks to SoundCloud directly — its unavailability must not kick the app offline.
  if (!isAuthPath(path) && !direct) {
    useAppStatusStore.getState().setBackendReachable(false);
  }
  throw lastError ?? new Error('All API hosts unreachable');
}

// ─── Aliases ────────────────────────────────────────────────

export const fetchWithAuthFallback = apiRequest;
