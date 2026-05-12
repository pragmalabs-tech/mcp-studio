/**
 * Pure state evolution. `applyAction` is one transition; `fold` is its
 * iterated form; `foldTrace` fills `stateAfter` on every step.
 */

import { driverFor } from "./registry";
import type { Action, State, Step, Trace } from "./types";

export function applyAction(state: State, action: Action): State {
  return driverFor(action).apply(state, action);
}

/** Returns one State per action. Length N for N actions. Initial state
 *  is NOT included (the caller already has it). */
export function fold(initial: State, actions: readonly Action[]): State[] {
  const out: State[] = [];
  let s = initial;
  for (const a of actions) out.push((s = applyAction(s, a)));
  return out;
}

/** Idempotent: calling twice on the same trace produces equal results. */
export function foldTrace(trace: Trace): Trace {
  const states = fold(
    trace.initialState,
    trace.steps.map((s) => s.action),
  );
  const steps: Step[] = trace.steps.map((s, i) => ({
    ...s,
    stateAfter: states[i],
  }));
  return { ...trace, steps };
}
