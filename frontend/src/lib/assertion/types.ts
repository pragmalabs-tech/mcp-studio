export type AssertStatus = "passed" | "failed" | "skipped";

export type Mode = "exact" | "shape" | "flaky" | "ignore";

/**
 * One assertable surface on an Action. Declared as a static array on each
 * Action subclass so the assertion engine never has to import an Action —
 * it receives `AssertablePoint[]` + raw values + a `Record<key, Mode>`.
 *
 * `path` is consumed by `getByPath` against the `ActionResult` for both
 * the recorded and live sides.
 */
export interface AssertablePoint {
  key: string;
  label: string;
  path: string;
  defaultMode: Mode;
  supportedModes: Mode[];
}

/**
 * Per-point failure detail surfaced by the action verifier. `key` ties
 * back to an `AssertablePoint`; `mode` is the resolved mode that ran.
 */
export interface PointFailure {
  key: string;
  mode: Mode;
  expected: unknown;
  actual: unknown;
  reason: string;
}

export interface AssertResult {
  status: AssertStatus;
  data: {
    expected?: unknown;
    actual?: unknown;
    reason?: string;
    /** Populated by `verifyAction` when one or more points failed. */
    failures?: PointFailure[];
  };
}

/**
 * Per-step verify report. Replay runs both compares per action — the
 * action's `result` is checked point-by-point (multi-mode); the state's
 * counter delta is one scope-wide mode.
 */
export interface AssertReport {
  action: AssertResult;
  state: AssertResult;
}

/**
 * Stored on `SavedTest`. Modes are configuration only; values being
 * compared never live here. Resolution order:
 *   result point: perAction[id].result[key] → AssertablePoint.defaultMode
 *   state:        perAction[id].state → defaults.state → "exact"
 */
export interface TestAssertionConfig {
  defaults?: { state?: Mode };
  perAction?: Record<
    string,
    {
      result?: Record<string, Mode>;
      state?: Mode;
    }
  >;
}
