import type { StateChange } from "@/lib/state/types";
import type { AssertResult } from "./types";

export interface VerifyStateOptions {
  /** Total attempts including the first try. Default 3. */
  attempts?: number;
  /** Delay between attempts in ms. Default 50. */
  delayMs?: number;
}

/**
 * Compare a recorded `StateChange` against the live one. The getter is
 * polled because in future an Action may settle asynchronously after its
 * MCP call returns; the retry/sleep loop covers that. Today both sides are
 * synchronous and the first call almost always wins.
 *
 * Action result comparison lives on the Action class itself
 * (`action.verify(recorded.result)`) — there's no `verifyAction` helper
 * because the action knows how to compare itself.
 */
export async function verifyState(
  recorded: StateChange | undefined,
  getActual: () => StateChange,
  options: VerifyStateOptions = {},
): Promise<AssertResult> {
  if (!recorded) {
    return {
      status: "skipped",
      data: { reason: "no recorded state change" },
    };
  }
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 50);

  let actual: StateChange = {};
  for (let i = 0; i < attempts; i++) {
    actual = getActual();
    if (deepEqual(actual, recorded)) {
      return {
        status: "passed",
        data: { expected: recorded, actual },
      };
    }
    if (i < attempts - 1 && delayMs > 0) await sleep(delayMs);
  }
  return {
    status: "failed",
    data: {
      expected: recorded,
      actual,
      reason: `state change mismatch after ${attempts} attempt(s)`,
    },
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
