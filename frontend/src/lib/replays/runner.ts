import { reconstructAction, type Action } from "@/lib/action";
import { WidgetCanvasClickAction } from "@/lib/action/widget_canvas_click";
import { recorder } from "@/lib/recorder/recorder";
import type { RecordedAction } from "@/lib/recorder/schema";
import {
  resolveResultModes,
  resolveStateMode,
  type AssertReport,
} from "@/lib/assertion";
import { eventBus } from "@/lib/event";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import type { SavedTest } from "@/lib/tests/storage";
import { saveReplay, type ReplayedAction, type SavedReplay } from "./storage";
import { waitUntil } from "@/lib/utils";
import {
  captureWidgetSnapshot,
  type WidgetSnapshot,
} from "@/components/studio/preview/snapshot/snapshot-utils";

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
  runGroupId?: string;
  profileName?: string;
  /**
   * Awaited before each step executes, after the "before" progress tick has
   * announced the upcoming action. In step mode the caller blocks here until
   * the user advances; in auto mode it resolves immediately. Stop also
   * resolves it (the runner re-checks `signal.aborted` right after).
   */
  gate?: (step: number) => void | Promise<void>;
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
  const { signal, onProgress, runGroupId, profileName, gate } = options;

  const steps = test.session.actions
    .map((source) => ({ source, action: reconstructAction(source.action) }))
    .filter(
      (s): s is { source: RecordedAction; action: Action } => s.action !== null,
    );
  const total = steps.length;

  recorder.suspend();
  useWidgetStore.setState((s) => ({ replayEpoch: s.replayEpoch + 1 }));

  // Old recordings (without cw/ch) need the iframe locked to the recorded
  // viewport size so normalized taps land at the right absolute pixel.
  // New recordings carry cw/ch and correct for canvas size in dispatchTaps,
  // so no size lock is needed.
  const recordedCanvas = steps.find(
    (s) =>
      s.action instanceof WidgetCanvasClickAction &&
      typeof s.action.data.canvas.vw === "number" &&
      typeof s.action.data.canvas.vh === "number" &&
      typeof s.action.data.canvas.cw !== "number",
  )?.action as WidgetCanvasClickAction | undefined;
  if (recordedCanvas) {
    const { vw, vh } = recordedCanvas.data.canvas;
    useWidgetStore.setState({ replaySizeLock: { width: vw!, height: vh! } });
    // Give React + the iframe a moment to resize (Excalidraw observes it).
    await waitUntil(() => {
      const w = useWidgetStore.getState()._iframeRef?.contentWindow?.innerWidth;
      return typeof w === "number" && Math.abs(w - vw!) <= 2;
    }, 1000);
  }

  const runStart = nowMs();
  let anyFailed = false;
  let aborted = false;

  // Live action refs kept until after the loop so we can inject snapshots
  // before serializing. Serialization happens in the post-loop pass below.
  const liveSteps: Array<{
    relMs: number;
    action: Action;
    liveChange: ReturnType<Action["change"]>;
    report: AssertReport;
    recordedActionId: string;
  }> = [];
  // The previously executed action, threaded into the next step's execute() so
  // it can react to what was left behind (e.g. a text step re-opening an
  // ephemeral editor by replaying the prior click).
  let previous: Action | undefined;

  // One snapshot slot per step. Populated as the run progresses:
  //   snapshots[i] = widget state captured after step i ran.
  // Step 0 stays null (nothing ran before it).
  // Middle steps are captured at the START of the next step (synchronously
  // before the next execute, so the DOM hasn't changed yet).
  // Last step is captured AFTER it runs (300ms settle).
  const snapshots: Array<WidgetSnapshot | null> = new Array(steps.length).fill(
    null,
  );

  try {
    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      const { source, action } = steps[i];
      onProgress?.({ step: i, total, action, phase: "before" });

      // Step-mode gate: blocks until the user advances; resolves immediately
      // in auto mode. Stop resolves it too, so re-check abort right after.
      await gate?.(i);
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      const widgetId = useWidgetStore.getState().activeWidgetId;
      const shouldSnapshotBeforNextAction = i > 0 && !!widgetId;
      const shouldTakeSnapshotAfterTimeout =
        i === steps.length - 1 && !!widgetId;

      // ── execute && take snapshot widget ────────────────────────────────────────────────
      const stepStart = nowMs();
      action.expectedEvents =
        (source.action as { events?: unknown[] }).events?.length ?? 0;
      eventBus.setActive(action);
      try {
        if (shouldSnapshotBeforNextAction) {
          snapshots[i - 1] = captureWidgetSnapshot(widgetId);
          console.log(
            `[runner step ${i}] snapshots[${i - 1}] captured before executing step ${i}: ${snapshots[i - 1] ? `html.length=${snapshots[i - 1]!.html.length}` : "null"}`,
          );
        }
        await action.execute({ previous });
      } catch (err) {
        if (!action.result) {
          action.setResult(false, undefined, {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        eventBus.setActive(null);
      }

      if (shouldTakeSnapshotAfterTimeout) {
        await new Promise<void>((r) => setTimeout(r, 300));
        snapshots[i] = captureWidgetSnapshot(widgetId);
        console.log(
          `[runner step ${i}] last step — snapshots[${i}] captured after 300ms: ${snapshots[i] ? `html.length=${snapshots[i]!.html.length}` : "null"}`,
        );
      }

      // ── assertion ──────────────────────────────────────────────────
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

      liveSteps.push({
        relMs: stepStart - runStart,
        action,
        liveChange,
        report,
        recordedActionId: recordedId,
      });
      onProgress?.({ step: i, total, action, phase: "after" });
      previous = action;

      // This will let the widget has enough time to render.
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    recorder.resume();
    if (recordedCanvas) useWidgetStore.setState({ replaySizeLock: null });
  }

  // Inject captured snapshots into action results, then serialize.
  // snapshots[i] = widget state after step i ran; injected into each action
  // so ReviewSnapshot shows the correct state for that step.
  for (let i = 0; i < liveSteps.length; i++) {
    if (snapshots[i]) {
      console.log(
        `[runner] injecting snapshots[${i}] into action ${liveSteps[i].action.type}`,
      );
      liveSteps[i].action.updateSnapshot(snapshots[i]);
    }
  }

  const out: ReplayedAction[] = liveSteps.map((s) => ({
    relMs: s.relMs,
    action: s.action.toJSON() as RecordedAction["action"],
    stateChange: s.liveChange,
    assert: s.report,
    recordedActionId: s.recordedActionId,
  }));

  const replay: SavedReplay = {
    id: crypto.randomUUID(),
    testId: test.id,
    testName: test.name,
    createdAt: new Date().toISOString(),
    durationMs: Math.round(nowMs() - runStart),
    status: !aborted && !anyFailed ? "passed" : "failed",
    actions: out,
    runGroupId,
    profileName,
  };
  await saveReplay(replay);
  return replay;
}
