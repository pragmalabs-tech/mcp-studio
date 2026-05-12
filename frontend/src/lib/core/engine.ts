/**
 * Engine: drives one Trace through the live system, producing a fresh
 * Trace whose `Step.stateAfter` was computed by `applyAction` per step.
 *
 * Loop rule: user/engine actions are dispatched (driver.dispatch), and
 * widget/server actions are awaited (collected via driver.attach until
 * one matches the next expected step or `awaitMs` elapses).
 */

import { applyAction } from "./fold";
import { DRIVERS } from "./registry";
import type {
  Action,
  AttachCtx,
  DispatchCtx,
  Driver,
  Step,
  Trace,
} from "./types";

export interface EngineDeps {
  signal: AbortSignal;
  /** Per-step await budget for widget/server actions. Default 2s. */
  awaitMs?: number;
  /** Override the driver list. Default: registry's `DRIVERS`. Tests
   *  pass fakes; production passes the registered drivers. */
  drivers?: readonly Driver[];
}

export async function run(trace: Trace, deps: EngineDeps): Promise<Trace> {
  const ctx: DispatchCtx & AttachCtx = { signal: deps.signal };
  const drivers = deps.drivers ?? DRIVERS;
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const driverFor = (a: Action): Driver | undefined => byId.get(a.driver);
  const ambient: Action[] = [];
  const detachers = drivers.map((d) => d.attach?.((a) => ambient.push(a), ctx));

  const t0 = performance.now();
  let state = trace.initialState;
  const steps: Step[] = [];

  try {
    for (const expected of trace.steps) {
      if (deps.signal.aborted) break;

      if (
        expected.action.source === "user" ||
        expected.action.source === "engine"
      ) {
        // Drain any ambient effects emitted before this user action.
        while (ambient.length > 0) {
          const a = ambient.shift()!;
          state = applyAction(state, a);
          steps.push({
            relMs: performance.now() - t0,
            action: a,
            stateAfter: state,
          });
        }
        await driverFor(expected.action)?.dispatch?.(expected.action, ctx);
        state = applyAction(state, expected.action);
        steps.push({
          relMs: performance.now() - t0,
          action: expected.action,
          stateAfter: state,
        });
        continue;
      }

      // widget/server: await ambient arrival or timeout. Match by
      // (driver, kind) so leftover ambient entries don't get consumed
      // in place of the expected step. 4s default — covers React
      // commit + iframe postMessage RTT + widget intent emission.
      const matched = await waitForKind(
        ambient,
        expected.action.driver,
        expected.action.kind,
        deps.awaitMs ?? 4000,
        deps.signal,
      );
      if (matched) {
        state = applyAction(state, matched);
        steps.push({
          relMs: performance.now() - t0,
          action: matched,
          stateAfter: state,
        });
      }
      // No match: leave a gap; the differ will surface step_missing.
    }
  } finally {
    for (const off of detachers) off?.();
  }

  return { ...trace, steps, capturedAt: new Date().toISOString() };
}

/** Resolve when `ambient` contains an entry matching (driver, kind), or
 *  after `ms` elapses, or when `signal` aborts. Removes + returns the
 *  matching entry on success, `null` on timeout/abort. Non-matching
 *  entries stay in `ambient` so they remain available to future steps. */
function waitForKind(
  ambient: Action[],
  driver: string,
  kind: string,
  ms: number,
  signal: AbortSignal,
): Promise<Action | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const idx = ambient.findIndex(
        (a) => a.driver === driver && a.kind === kind,
      );
      if (idx >= 0) {
        const [m] = ambient.splice(idx, 1);
        return resolve(m);
      }
      if (signal.aborted) return resolve(null);
      if (Date.now() - start >= ms) return resolve(null);
      setTimeout(tick, 10);
    };
    tick();
  });
}
