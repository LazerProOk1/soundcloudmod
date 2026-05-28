import { fetch } from '@tauri-apps/plugin-http';
import { toast } from 'sonner';
import { useAppStatusStore } from '../stores/app-status';
import { useSettingsStore } from '../stores/settings';
import { noteAuthGap, noteRateLimit, noteSuccess } from './auth-recovery';
import { API_BASE, BYPASS_API_BASE } from './constants';
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

// ─── Host resolution ────────────────────────────────────────

const AUTH_PATHS = ['/auth/'];

function isAuthPath(path: string): boolean {
  return AUTH_PATHS.some((p) => path.startsWith(p));
}

function resolveApiBases(path: string): string[] {
  // Auth paths: always try primary API first, BYPASS as fallback.
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
const BYPASS_TIMEOUT_MS = 4_000;
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
  const timer = setTimeout(
    () => controller.abort(new DOMException('Timeout', 'TimeoutError')),
    timeoutMs,
  );

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
      const msg: string = parsed.message || parsed.error || '';
      // Suppress subscription-gate errors — they're not actionable for the user.
      if (/star|subscription|premium|boosty/i.test(msg)) return;
      toast.error(msg || `Error ${err.status}`);
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
  return _apiRequestInner<T>(path, options, timeoutMs, { silent, fetchOptions, headers });
}

async function _apiRequestInner<T>(
  path: string,
  _options: ApiOptions,
  timeoutMs: number | undefined,
  ctx: {
    silent: boolean | undefined;
    fetchOptions: Omit<ApiOptions, 'silent'>;
    headers: Headers;
  },
): Promise<T> {
  const { silent, fetchOptions, headers } = ctx;
  // Защита от попадания строки "undefined"/"null" в header при апгрейдах формата API.
  if (sessionId && sessionId !== 'undefined' && sessionId !== 'null') {
    headers.set('x-session-id', sessionId);
  }

  if (!headers.has('Content-Type') && fetchOptions.body)
    headers.set('Content-Type', 'application/json');

  const bases = resolveApiBases(path);
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

  // Only mark the backend as unreachable for non-auth paths.
  // Auth endpoints use a different host (BYPASS) that can be unavailable independently.
  if (!isAuthPath(path)) {
    useAppStatusStore.getState().setBackendReachable(false);
  }
  throw lastError ?? new Error('All API hosts unreachable');
}

// ─── Aliases ────────────────────────────────────────────────

export const fetchWithAuthFallback = apiRequest;
