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
 */

import { create } from "zustand";
import { probeMcpHealth, type McpHealth } from "./api";
import { useStudioStore } from "./store";

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
  // Each `_start()` bumps `_generation`. The current loop checks the
  // generation before applying its result; stale loops just drop their
  // result and exit.
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
      // A fresh authoritative result resets the backoff schedule. Stop a
      // pending probe so the next tick honors the new interval.
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

// Lazy singleton bootstrap. The first time any component calls
// `useMcpHealth()` we kick the loop and wire the auth-change subscription.
// Module-load side effects are avoided so tests that never call the hook
// don't spawn fetches.
let booted = false;
function ensureBooted() {
  if (booted) return;
  booted = true;

  useHealthStore.getState()._start();

  let prevToken = useStudioStore.getState().oauth.accessToken;
  let prevMethod = useStudioStore.getState().authMethod;
  useStudioStore.subscribe((state) => {
    const nextToken = state.oauth.accessToken;
    const nextMethod = state.authMethod;
    if (nextToken !== prevToken || nextMethod !== prevMethod) {
      prevToken = nextToken;
      prevMethod = nextMethod;
      useHealthStore.getState()._start();
    }
  });

  // Health store is the single source of truth for connectivity. Only
  // an explicit OFFLINE -> ONLINE transition triggers a refetch - the
  // initial `checking -> connected` is just app boot (loadAll is already
  // running), and `connected -> connected` ticks are noise.
  //
  // On the offline -> online edge:
  //  - clear any stale `mcpError` left by a failed `loadAll`
  //  - re-run `loadAll` so tools/resources reflect what the server
  //    actually has now (which may have changed during downtime).
  // We don't overwrite `mcpError` on disconnect because `loadAll`'s
  // message usually carries more detail than a generic "unreachable".
  const isOffline = (s: McpHealth) =>
    s === "disconnected" || s === "unauthorized";
  let prevStatus: McpHealth = useHealthStore.getState().status;
  useHealthStore.subscribe((state) => {
    if (state.status === "connected" && isOffline(prevStatus)) {
      const s = useStudioStore.getState();
      if (s.mcpError) useStudioStore.setState({ mcpError: null });
      if (!s.loading) s.loadAll();
    }
    prevStatus = state.status;
  });
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
