export type AssertStatus = "passed" | "failed" | "skipped";

export interface AssertResult {
  status: AssertStatus;
  data: {
    expected?: unknown;
    actual?: unknown;
    reason?: string;
  };
}

/**
 * Per-step verify report. Replay runs both compares per action — the
 * action's `result` (response/error payload) is checked separately from
 * the state's counter delta.
 */
export interface AssertReport {
  action: AssertResult;
  state: AssertResult;
}
