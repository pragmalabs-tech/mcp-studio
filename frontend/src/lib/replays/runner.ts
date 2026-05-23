import {
  reconstructAction,
  ToolCallAction,
  ResourceReadAction,
  type Action,
} from "@/lib/action";
import { recorder } from "@/lib/recorder/bus";
import type { RecordedAction } from "@/lib/recorder/schema";
import { callTool, readResource } from "@/lib/studio/api";
import type { SavedTest } from "@/lib/tests/storage";
import { saveReplay, type SavedReplay } from "./storage";

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
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
 * Re-execute every action in `test`'s recorded session against the live MCP
 * server, capturing per-step success/result. The recorder is suspended for
 * the duration so the replay-driven `recorder.record(...)` calls inside
 * `recordedMcpCall` don't pollute the live timeline.
 *
 * Honors `options.signal` between steps (in-flight MCP calls still complete).
 * Fires `options.onProgress` before and after each step so callers can drive
 * a progress UI.
 */
export async function runReplay(
  test: SavedTest,
  options: ReplayOptions = {},
): Promise<SavedReplay> {
  const { signal, onProgress } = options;

  // Reconstruct upfront so total matches the actually-executed step count.
  const reconstructed = test.session.actions
    .map((r) => reconstructAction(r.action))
    .filter((a): a is Action => a !== null);
  const total = reconstructed.length;

  recorder.suspend();
  const runStart = nowMs();
  const actions: RecordedAction[] = [];
  let allPassed = true;
  let aborted = false;

  try {
    for (let i = 0; i < reconstructed.length; i++) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      const action = reconstructed[i];
      const stepStart = nowMs();
      onProgress?.({ step: i, total, action, phase: "before" });
      try {
        if (action instanceof ToolCallAction) {
          const result = await callTool(
            action.data.tool,
            (action.data.params as Record<string, unknown>) ?? {},
          );
          action.setResult(true, result);
        } else if (action instanceof ResourceReadAction) {
          const result = await readResource(action.data.uri);
          action.setResult(true, result);
        } else {
          action.setResult(true);
        }
      } catch (err) {
        action.setResult(false, undefined, { message: errorMessage(err) });
        allPassed = false;
      }
      actions.push({
        relMs: stepStart - runStart,
        action: action.toJSON() as RecordedAction["action"],
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
    status: !aborted && allPassed ? "passed" : "failed",
    actions,
  };
  saveReplay(replay);
  return replay;
}
