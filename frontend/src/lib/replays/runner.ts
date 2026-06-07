import { reconstructAction, type Action } from "@/lib/action";
import { WidgetClickAction } from "@/lib/action/widget_click";
import { WidgetTextInputAction } from "@/lib/action/widget_text_input";
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

  // Lock the preview to the size the canvas was recorded at. Canvas widgets map
  // screen pixels to scene coordinates at a fixed zoom, so replaying at a
  // different size lands taps in the wrong place. Use the first canvas action's
  // recorded iframe size; wait for the preview to actually reach it before steps.
  const recordedCanvas = steps.find(
    (s) =>
      s.action instanceof WidgetCanvasClickAction &&
      typeof s.action.data.canvas.vw === "number" &&
      typeof s.action.data.canvas.vh === "number",
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
  const out: ReplayedAction[] = [];
  let anyFailed = false;
  let aborted = false;
  // The previously executed action, threaded into the next step's execute() so
  // it can react to what was left behind (e.g. a text step re-opening an
  // ephemeral editor by replaying the prior click).
  let previous: Action | undefined;

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

      const stepStart = nowMs();
      eventBus.setActive(action);
      try {
        if (
          action instanceof WidgetClickAction ||
          action instanceof WidgetTextInputAction ||
          action instanceof WidgetCanvasClickAction
        ) {
          // Open-window actions: drive close via the recorded event count
          // (live events flow in asynchronously via the bus during the
          // settle window).
          const expectedEvents =
            (source.action as { events?: unknown[] }).events?.length ?? 0;
          const settled = action.execute({ previous });
          await waitUntil(() => action.events.length >= expectedEvents, 5000);
          await new Promise((r) => setTimeout(r, 150)); // DOM rerender grace
          action.close();
          await settled;
        } else {
          // Direct action: execute resolves when its own I/O is done; events
          // accumulate synchronously via the bus during that window.
          await action.execute({ previous });
        }
      } catch (err) {
        // A thrown step (e.g. a widget click that can't be dispatched against
        // a canvas element) must not sink the whole replay. Capture it as a
        // failed result so the run still saves and the offending step shows
        // up in the report instead of vanishing.
        if (!action.result) {
          action.setResult(false, undefined, {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        eventBus.setActive(null);
      }
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
      previous = action;
    }
  } finally {
    recorder.resume();
    if (recordedCanvas) useWidgetStore.setState({ replaySizeLock: null });
  }

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
