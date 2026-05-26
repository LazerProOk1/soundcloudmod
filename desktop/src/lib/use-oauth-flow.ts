import { fetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuthFallback } from './api-client';
import { API_BASE, BYPASS_API_BASE } from './constants';

interface LoginResponse {
  url: string;
  loginRequestId: string;
}

interface LoginStatusResponse {
  status: 'pending' | 'completed' | 'failed' | 'expired';
  step?: 'token' | 'profile' | 'session';
  sessionId?: string;
  username?: string;
  error?: string;
}

export type OAuthStep = 'waiting' | 'token' | 'profile' | 'session';
export type OAuthFlowError = { kind: 'failed' | 'expired' | 'unreachable'; message: string };

const POLL_INTERVAL_MS = 700;
/** If the backend hasn't responded at all after this time, surface an 'unreachable' error. */
const UNREACHABLE_AFTER_MS = 15_000;

export function useOAuthFlow(
  onSuccess: (sessionId: string) => void,
  onFailure?: (err: OAuthFlowError) => void,
) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [step, setStep] = useState<OAuthStep>('waiting');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onFailureRef = useRef(onFailure);
  onSuccessRef.current = onSuccess;
  onFailureRef.current = onFailure;

  const cancel = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setIsPolling(false);
    setAuthUrl(null);
    setStep('waiting');
  }, []);

  useEffect(() => cancel, [cancel]);

  const startLogin = useCallback(async () => {
    cancel();
    setIsPolling(true);
    setStep('waiting');

    const t0 = performance.now();

    let loginRequestId: string;
    let url: string;
    try {
      const resp = await fetchWithAuthFallback<LoginResponse>('/auth/login');
      loginRequestId = resp.loginRequestId;
      url = resp.url;
    } catch (err) {
      console.error('[Auth] /auth/login FAILED', err);
      cancel();
      onFailureRef.current?.({ kind: 'unreachable', message: String(err) });
      return;
    }

    setAuthUrl(url);
    await openUrl(url);

    let pollCount = 0;

    const tryPoll = async (base: string): Promise<LoginStatusResponse | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const res = await fetch(
          `${base}/auth/login/status?id=${encodeURIComponent(loginRequestId)}`,
          { signal: controller.signal, cache: 'no-store' as RequestCache },
        );
        if (!res.ok) {
          console.warn(`[Auth] poll #${pollCount} HTTP ${res.status} from ${base}`);
          return null;
        }
        return (await res.json()) as LoginStatusResponse;
      } catch (e) {
        console.warn(`[Auth] poll #${pollCount} fetch error from ${base}:`, e);
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const pollOnce = async () => {
      pollCount++;
      let data: LoginStatusResponse | null = null;
      try {
        data = await tryPoll(API_BASE);
      } catch {
        try {
          data = await tryPoll(BYPASS_API_BASE);
        } catch {}
      }

      if (!data) {
        // Backend hasn't responded at all — check if we've been waiting too long
        if (performance.now() - t0 > UNREACHABLE_AFTER_MS) {
          console.error('[Auth] Backend unreachable after', UNREACHABLE_AFTER_MS, 'ms');
          cancel();
          onFailureRef.current?.({ kind: 'unreachable', message: 'Backend not responding' });
          return;
        }
        pollRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
        return;
      }

      const elapsed = (performance.now() - t0).toFixed(0);

      if (data.step) setStep(data.step);

      if (data.status === 'completed' && data.sessionId) {
        cancel();
        onSuccessRef.current(data.sessionId);
        return;
      }
      if (data.status === 'failed' || data.status === 'expired') {
        console.error(`[Auth] ❌ Login ${data.status} after ${elapsed}ms:`, data.error);
        cancel();
        onFailureRef.current?.({ kind: data.status, message: data.error ?? 'Login failed' });
        return;
      }
      pollRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
    };

    pollRef.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
  }, [cancel]);

  return { startLogin, authUrl, isPolling, step, cancel };
}
