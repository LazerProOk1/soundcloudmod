/**
 * Session recovery orchestrator.
 *
 * Tracks rate-limit events and auth gaps, then drives silent renewal
 * followed by a modal if silent renewal fails.
 *
 * Public API (called from api-client.ts):
 *   noteRateLimit() — call on every 429
 *   noteAuthGap()   — call on 401 / missing user
 *   noteSuccess()   — call on every successful response
 *
 * Public API (called from UI / auth flow):
 *   retryRenew()    — manual retry from modal
 *   completeReauth(sessionId) — finalise OAuth re-login
 */

import { queryClient } from './query-client';
import { useAuthStore } from '../stores/auth';
import { useAuthRecoveryStore } from '../stores/auth-recovery';

// ─── Rate-limit accumulator ──────────────────────────────────

const RL_WINDOW_MS   = 15_000; // sliding window
const RL_THRESHOLD   = 3;      // hits before triggering recovery

let rlHits: number[] = [];

// ─── Single-flight guard ─────────────────────────────────────

let inFlight = false;
let gen = 0;           // incremented on each new recovery attempt
let cancelledGen = -1; // generation we decided to cancel
const COOLDOWN_MS = 5_000;

// ─── Internal helpers ────────────────────────────────────────

async function runRenew(manual: boolean): Promise<void> {
  const store = useAuthRecoveryStore.getState();

  if (manual) store.setBusy(true);

  const myGen = ++gen;
  inFlight = true;

  try {
    await useAuthStore.getState().fetchUser();
    // Success — clear state
    if (myGen !== cancelledGen) {
      useAuthRecoveryStore.getState().markRecovered();
      queryClient.invalidateQueries();
    }
  } catch {
    if (myGen === cancelledGen) return; // was superseded
    // Silent renewal failed → show modal
    useAuthRecoveryStore.getState().setPhase('modal');
  } finally {
    inFlight = false;
    if (manual) useAuthRecoveryStore.getState().setBusy(false);
  }
}

function startRecovery(): void {
  const s = useAuthRecoveryStore.getState();

  // Cooldown: don't re-trigger within 5 s of a successful recovery
  if (s.recoveredAt && Date.now() - s.recoveredAt < COOLDOWN_MS) return;

  if (s.phase !== 'idle') return; // already recovering
  if (inFlight) return;

  s.setPhase('silent');
  void runRenew(false);
}

// ─── Public API ──────────────────────────────────────────────

export function noteRateLimit(): void {
  const now = Date.now();
  rlHits.push(now);
  rlHits = rlHits.filter((t) => now - t < RL_WINDOW_MS);
  if (rlHits.length >= RL_THRESHOLD) {
    rlHits = [];
    startRecovery();
  }
}

export function noteAuthGap(): void {
  startRecovery();
}

export function noteSuccess(): void {
  if (rlHits.length) rlHits = [];
  const s = useAuthRecoveryStore.getState();
  if (s.phase === 'idle' || s.busy || s.oauthActive) return;
  cancelledGen = gen;
  s.markRecovered();
}

export function retryRenew(): Promise<void> {
  return runRenew(true);
}

export function completeReauth(sessionId: string): void {
  const auth = useAuthStore.getState();
  auth.setSession(sessionId);
  auth.fetchUser().catch(() => {});
  useAuthRecoveryStore.getState().markRecovered();
  queryClient.invalidateQueries();
}
