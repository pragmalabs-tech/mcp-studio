/**
 * Re-derive replay step status against the user's *current* assertion
 * modes. Replays bake their per-step `AssertReport` at run time, but the
 * user can later change modes (shape / ignore) on the test —
 * which should make a previously-failed step pass without re-running.
 * Both the replay dialog and the test card's history list use these
 * helpers so their pass/fail UI stays consistent.
 */

import {
  resolveResultModes,
  resolveStateMode,
  verifyAction,
  compareByMode,
  type AssertResult,
  type AssertReport,
} from "@/lib/assertion";
import { assertablePointsForType } from "@/lib/action";
import type { SavedTest } from "@/lib/tests/storage";
import type { ReplayedAction, SavedReplay } from "./storage";
import type { RecordedAction } from "@/lib/recorder/schema";
import type { Status } from "@/lib/status";

/** Step-level pass/fail roll-up. Skipped counts as passed for status. */
export function stepStatus(assert: AssertReport): Status {
  if (assert.action.status === "failed" || assert.state.status === "failed") {
    return "failed";
  }
  return "passed";
}

/**
 * Resolve which `RecordedAction` in the test session this replay step
 * came from. New replays carry `recordedActionId`; older ones fall back
 * to positional match against the test session's reconstructable actions.
 */
export function findRecordedBaseline(
  test: SavedTest | null,
  replayed: ReplayedAction,
  index: number,
): RecordedAction | undefined {
  if (!test) return undefined;
  if (replayed.recordedActionId) {
    return test.session.actions.find(
      (a) => a.action.id === replayed.recordedActionId,
    );
  }
  return test.session.actions[index];
}

/**
 * Recompute one step's `AssertReport` using `test.assertions` rather
 * than the report stored on the replay. Pure — no MCP calls. Falls
 * back to the stored report when we can't resolve the recorded
 * baseline or when the action type doesn't declare points.
 */
export function liveAssertFor(
  test: SavedTest | null,
  replayed: ReplayedAction,
  index: number,
): AssertReport {
  if (!test) return replayed.assert;
  const recorded = findRecordedBaseline(test, replayed, index);
  if (!recorded) return replayed.assert;
  const recordedId = replayed.recordedActionId ?? recorded.action.id;
  const points = assertablePointsForType(recorded.action.type);
  if (points.length === 0) return replayed.assert;
  const modes = resolveResultModes(test.assertions, recordedId, points);
  const action = verifyAction(
    points,
    recorded.action.result,
    replayed.action.result,
    modes,
  );
  const stateMode = resolveStateMode(test.assertions, recordedId);
  const state: AssertResult = recorded.stateChange
    ? compareByMode(stateMode, recorded.stateChange, replayed.stateChange)
    : { status: "skipped", data: { reason: "no recorded state change" } };
  return { action, state };
}

/**
 * Roll up a whole replay's status against the test's current assertion
 * modes. Returns the same shape that `SavedReplay` records at run-time
 * (`status`, `passed`, `total`) but computed live.
 */
export function liveReplayStatus(
  test: SavedTest | null,
  replay: SavedReplay,
): { status: Status; passed: number; total: number } {
  const reports = replay.actions.map((a, i) => liveAssertFor(test, a, i));
  const total = reports.length;
  const passed = reports.filter((r) => stepStatus(r) === "passed").length;
  const status: Status = reports.some((r) => stepStatus(r) === "failed")
    ? "failed"
    : "passed";
  return { status, passed, total };
}
