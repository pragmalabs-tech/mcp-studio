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

      // widget/server: await ambient arrival or timeout.
      const matched = await waitFor(ambient, deps.awaitMs ?? 2000, deps.signal);
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

/** Resolve when `ambient` has at least one entry, or after `ms` elapses,
 *  or when `signal` aborts. Pops + returns the first ambient action on
 *  success, `null` on timeout/abort. */
function waitFor(
  ambient: Action[],
  ms: number,
  signal: AbortSignal,
): Promise<Action | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (ambient.length > 0) return resolve(ambient.shift()!);
      if (signal.aborted) return resolve(null);
      if (Date.now() - start >= ms) return resolve(null);
      setTimeout(tick, 10);
    };
    tick();
  });
}
