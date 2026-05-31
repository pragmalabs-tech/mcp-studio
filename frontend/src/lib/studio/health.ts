/**
 * Singleton zustand store + hook for live MCP server health.
 *
 * One polling loop runs for the whole app lifetime. Every component
 * subscribes via `useMcpHealth()` and reads the same shared status, so
 * remounts / route changes / HMR don't restart the loop and the dot
 * stays consistent.
 *
 * Cadence:
 *   - 2s while connected.
 *   - 2s -> 4s -> 8s -> 10s backoff on transport failure.
 *   - Stops entirely on 401/403; user must `recheck()` (or re-auth) to
 *     restart - hammering with a stale token risks lockout.
 *
 * Restart triggers (auto): OAuth access token change, auth method change.
 * Restart triggers (manual): `recheck()` from the status dot.
 *
 * NOTE: This module deliberately does NOT import the profile-store or
 * widget-store to avoid a circular dependency via api.ts. The auth-change
 * restart and reconnect-loadAll subscriptions are wired up from those stores
 * themselves after they are initialized.
 */

import { create } from "zustand";
import { probeMcpHealth, type McpHealth } from "./api";

export type { McpHealth };

const BASE_INTERVAL_MS = 2_000;
const MAX_INTERVAL_MS = 10_000;

interface HealthStore {
  status: McpHealth;
  recheck(): void;
  /** @internal */ _timer: ReturnType<typeof setTimeout> | null;
  /** @internal */ _interval: number;
  /** @internal */ _generation: number;
  /** @internal */ _start(): void;
  /** @internal */ _stop(): void;
  /** @internal */ _set(status: McpHealth): void;
}

export const useHealthStore = create<HealthStore>((set, get) => {
  async function tick() {
    const gen = get()._generation;
    const result = await probeMcpHealth();
    if (gen !== get()._generation) return;
    set({ status: result });
    if (result === "unauthorized") {
      set({ _timer: null });
      return;
    }
    const nextInterval =
      result === "disconnected"
        ? Math.min(get()._interval * 2, MAX_INTERVAL_MS)
        : BASE_INTERVAL_MS;
    const timer = setTimeout(tick, nextInterval);
    set({ _timer: timer, _interval: nextInterval });
  }

  return {
    status: "checking",
    _timer: null,
    _interval: BASE_INTERVAL_MS,
    _generation: 0,
    _start() {
      get()._stop();
      set({
        _generation: get()._generation + 1,
        status: "checking",
        _interval: BASE_INTERVAL_MS,
      });
      tick();
    },
    _stop() {
      const t = get()._timer;
      if (t) clearTimeout(t);
      set({ _timer: null });
    },
    recheck() {
      get()._start();
    },
    _set(status) {
      set({ status });
      if (status === "connected") {
        const t = get()._timer;
        if (t) clearTimeout(t);
        set({ _timer: null, _interval: BASE_INTERVAL_MS });
      }
    },
  };
});

/**
 * Report the result of an MCP interaction (real call or probe) into the
 * shared health store. Any successful response is `connected`; auth
 * shapes are `unauthorized`; transport-level failures are `disconnected`.
 * Called from `api.ts` after every MCP call, so reload's `loadAll` and
 * the periodic probe share one truth.
 */
export function reportHealth(status: McpHealth): void {
  useHealthStore.getState()._set(status);
}

// Lazy singleton bootstrap. Only starts the polling loop — subscriptions to
// profile/widget stores are wired up from those stores themselves to avoid
// the api.ts → health.ts → stores → api.ts circular initialization chain.
let booted = false;
function ensureBooted() {
  if (booted) return;
  booted = true;
  useHealthStore.getState()._start();
}

export interface UseMcpHealthResult {
  status: McpHealth;
  /** Force a fresh probe immediately (resets the backoff schedule). */
  recheck(): void;
}

export function useMcpHealth(): UseMcpHealthResult {
  ensureBooted();
  const status = useHealthStore((s) => s.status);
  const recheck = useHealthStore((s) => s.recheck);
  return { status, recheck };
}
