import type { StateChange } from "@/lib/state/types";
import type { AssertResult, Mode } from "./types";
import { compareByMode } from "./dispatch";

export interface VerifyStateOptions {
  /** Total attempts including the first try. Default 3. */
  attempts?: number;
  /** Delay between attempts in ms. Default 50. */
  delayMs?: number;
  /** Mode to compare with. Default `exact`. */
  mode?: Mode;
}

/**
 * Compare a recorded `StateChange` against the live one using the chosen
 * mode. The retry/poll loop exists because in future an Action may settle
 * asynchronously after its MCP call returns; today both sides are
 * synchronous and the first call almost always wins.
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
  const mode = options.mode ?? "exact";

  let actual: StateChange = {};
  let last: AssertResult = { status: "failed", data: {} };
  for (let i = 0; i < attempts; i++) {
    actual = getActual();
    last = compareByMode(mode, recorded, actual);
    if (last.status === "passed") return last;
    if (i < attempts - 1 && delayMs > 0) await sleep(delayMs);
  }
  return {
    status: "failed",
    data: {
      expected: recorded,
      actual,
      reason: `${last.data.reason ?? "mismatch"} after ${attempts} attempt(s)`,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
