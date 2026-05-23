import type { StateChange } from "@/lib/state/types";
import type { AssertResult } from "@/lib/assertion/types";

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: { message: string };
}

/**
 * An Action is the studio's unit of recordable work. Each subclass owns
 * one MCP operation and exposes three concerns:
 *
 *   - `execute()` — async I/O. Populates `this.result` with the response
 *     or the error message. Returns void; callers read `result` after.
 *   - `change()` — the StateChange (counter delta) this action contributes
 *     given its result. Pure derivation, no I/O.
 *   - `verify(recordedResult)` — compare this action's live result against
 *     a recorded baseline; returns an AssertResult.
 *
 * Separating result-data (on the Action) from counter-deltas (in State)
 * means replay verification is two clean compares: one for the response,
 * one for the state effect.
 */
export abstract class Action<T = any> {
  readonly id: string;
  readonly type: string;
  readonly data: T;
  readonly timestamp: number;

  /** Populated by `execute()` once the MCP call settles. */
  result?: ActionResult;

  constructor(type: string, data: T) {
    this.id = crypto.randomUUID();
    this.type = type;
    this.data = data;
    this.timestamp = Date.now();
  }

  abstract execute(): Promise<void>;

  /** State delta this action contributes given its current `result`. */
  abstract change(): StateChange;

  /**
   * Compare `this.result` against a recorded baseline. Default implementation
   * checks the `success` boolean and exposes both sides in `data`. Subclasses
   * can override (e.g. to deep-compare specific response fields), but the
   * base check is enough for most actions.
   */
  verify(recorded: ActionResult | undefined): AssertResult {
    if (!recorded) {
      return { status: "skipped", data: { reason: "no recorded result" } };
    }
    if (!this.result) {
      return {
        status: "failed",
        data: {
          expected: recorded,
          actual: undefined,
          reason: "action did not produce a result",
        },
      };
    }
    if (recorded.success !== this.result.success) {
      return {
        status: "failed",
        data: {
          expected: recorded,
          actual: this.result,
          reason: `success mismatch (expected ${recorded.success}, got ${this.result.success})`,
        },
      };
    }
    return {
      status: "passed",
      data: { expected: recorded, actual: this.result },
    };
  }

  setResult(
    success: boolean,
    data?: unknown,
    error?: { message: string },
  ): void {
    this.result = { success, data, error };
  }

  toJSON(): object {
    const json: any = {
      id: this.id,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
    };
    if (this.result) json.result = this.result;
    return json;
  }
}
