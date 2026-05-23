import { reconstructAction, type Action } from "@/lib/action";
import { recorder } from "@/lib/recorder/bus";
import type { RecordedAction } from "@/lib/recorder/schema";
import {
  resolveResultModes,
  resolveStateMode,
  type AssertReport,
} from "@/lib/assertion";
import type { SavedTest } from "@/lib/tests/storage";
import { saveReplay, type ReplayedAction, type SavedReplay } from "./storage";

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

export interface ReplayProgress {
  /** 0-indexed step about to run (or just-finished if `phase === "after"`). */
  step: number;
  /** Total reconstructable actions in the run. */
  total: number;
  /** The action being processed; null for skipped (unknown) entries. */
  action: Action | null;
  phase: "before" | "after";
}

export interface ReplayOptions {
  signal?: AbortSignal;
  onProgress?: (info: ReplayProgress) => void;
}

/**
 * Returns the number of executable actions in a test (those a reconstructor
 * recognizes). Callers use this to size progress indicators before invoking
 * `runReplay`.
 */
export function countReplayableActions(test: SavedTest): number {
  return test.session.actions.filter(
    (r) => reconstructAction(r.action) !== null,
  ).length;
}

/**
 * Re-run every action in a saved test. Each step does two compares:
 *   - Action verify: live action.result vs recorded action.result, run
 *     point-by-point with the modes resolved from `test.assertions`.
 *   - State verify: live action.change() vs recorded stateChange, with a
 *     single resolved mode for the whole `StateChange`.
 *
 * The recorder is suspended for the duration so replay-driven MCP calls
 * don't pollute the live timeline. `options.signal` aborts between steps
 * (in-flight calls still complete).
 */
export async function runReplay(
  test: SavedTest,
  options: ReplayOptions = {},
): Promise<SavedReplay> {
  const { signal, onProgress } = options;

  const steps = test.session.actions
    .map((source) => ({ source, action: reconstructAction(source.action) }))
    .filter(
      (s): s is { source: RecordedAction; action: Action } => s.action !== null,
    );
  const total = steps.length;

  recorder.suspend();
  const runStart = nowMs();
  const out: ReplayedAction[] = [];
  let anyFailed = false;
  let aborted = false;

  try {
    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      const { source, action } = steps[i];
      const stepStart = nowMs();
      onProgress?.({ step: i, total, action, phase: "before" });

      await action.execute();
      const liveChange = action.change();

      const recordedId = source.action.id;
      const modes = resolveResultModes(
        test.assertions,
        recordedId,
        action.getAssertablePoints(),
      );
      const stateMode = resolveStateMode(test.assertions, recordedId);

      const report: AssertReport = {
        action: action.verifyResult(source.action.result, modes),
        state: await action.verifyStateChange(source.stateChange, {
          attempts: 3,
          delayMs: 50,
          mode: stateMode,
        }),
      };
      if (
        report.action.status === "failed" ||
        report.state.status === "failed"
      ) {
        anyFailed = true;
      }

      out.push({
        relMs: stepStart - runStart,
        action: action.toJSON() as RecordedAction["action"],
        stateChange: liveChange,
        assert: report,
        recordedActionId: recordedId,
      });
      onProgress?.({ step: i, total, action, phase: "after" });
    }
  } finally {
    recorder.resume();
  }

  const replay: SavedReplay = {
    id: crypto.randomUUID(),
    testId: test.id,
    testName: test.name,
    createdAt: new Date().toISOString(),
    durationMs: Math.round(nowMs() - runStart),
    status: !aborted && !anyFailed ? "passed" : "failed",
    actions: out,
  };
  saveReplay(replay);
  return replay;
}
