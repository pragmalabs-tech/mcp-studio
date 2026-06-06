import type { StateChange } from "@/lib/state/types";
import type {
  AssertablePoint,
  AssertResult,
  Mode,
} from "@/lib/assertion/types";
import { verifyAction } from "@/lib/assertion/verify_action";
import {
  verifyState,
  type VerifyStateOptions,
} from "@/lib/assertion/verify_state";
import type { Event } from "@/lib/event/types";

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: { message: string };
}

/** Forward-state passed into `execute()` so a step can react to what the
 *  previous step left behind — e.g. a text step re-opening an ephemeral editor
 *  by replaying the previous click. Optional; most actions ignore it. */
export interface ExecuteContext {
  previous?: Action;
}

/**
 * An Action is the studio's unit of recordable work. Each subclass owns
 * one MCP operation and exposes:
 *
 *   - `execute()` — async I/O. Populates `this.result` with the response
 *     or the error message. Returns void; callers read `result` after.
 *   - `change()` — the StateChange (counter delta) this action contributes
 *     given its result. Pure derivation, no I/O.
 *   - `static assertablePoints` — the assertable surface this Action type
 *     exposes for replay verification. Engine receives this and the
 *     resolved per-key modes; it never imports the Action class itself.
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

  /** Side-effect observations emitted during this Action's window. Built
   *  up by the event bus (see `lib/event/bus.ts`) while the Action is
   *  active. Direct Actions populate this synchronously during execute();
   *  open-window Actions accept events arriving asynchronously from
   *  external sources (bridge, future server push). */
  events: Event[] = [];

  /**
   * Static-declared assertable surface. Subclasses override with their
   * specific points; the base list is empty so an undeclared action
   * verifies as "passed" (nothing to check).
   */
  static assertablePoints: AssertablePoint[] = [];

  constructor(type: string, data: T) {
    this.id = crypto.randomUUID();
    this.type = type;
    this.data = data;
    this.timestamp = Date.now();
  }

  abstract execute(ctx?: ExecuteContext): Promise<void>;

  /** State delta this action contributes given its current `result`. */
  abstract change(): StateChange;

  /** Convenience accessor for the static `assertablePoints` on this instance. */
  getAssertablePoints(): AssertablePoint[] {
    return (this.constructor as typeof Action).assertablePoints;
  }

  /**
   * Compare `this.result` (set by `execute()`) against a recorded baseline.
   * Default walks the static `assertablePoints` and dispatches each point
   * by its resolved mode. Subclasses override only when they need verify
   * behavior the modes can't express on their own.
   */
  verifyResult(
    recorded: ActionResult | undefined,
    modes: Record<string, Mode> | undefined,
  ): AssertResult {
    return verifyAction(
      this.getAssertablePoints(),
      recorded,
      this.result,
      modes,
    );
  }

  /**
   * Compare `this.change()` against a recorded `StateChange` using one
   * mode for the whole object, with the same retry/poll loop the engine
   * has always done.
   */
  async verifyStateChange(
    recorded: StateChange | undefined,
    opts: VerifyStateOptions = {},
  ): Promise<AssertResult> {
    return verifyState(recorded, () => this.change(), opts);
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
    if (this.events.length > 0) {
      json.events = this.events.map((e) => e.toJSON());
    }
    return json;
  }
}
