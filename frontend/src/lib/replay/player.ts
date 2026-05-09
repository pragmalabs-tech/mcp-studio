import type { Action, ActionKind, Recorded, Test } from "@/lib/recorder/schema";
import type { AssertionResult } from "./asserter";
import { assertFor } from "./asserter";
import type { Driver, DriverContext, PlayerStore } from "./drivers/types";
import type { BridgeClient } from "./bridge-client";
import type { ArtifactCollector } from "./artifacts";
import { recorder } from "@/lib/recorder/bus";
import { skipReasonForKind } from "@/lib/recorder/summarize";
import { timeoutFor } from "./timing";

export interface StepResult {
  index: number;
  action: Recorded;
  status: "pass" | "fail" | "timeout" | "skip";
  durationMs: number;
  reason?: string;
  observation?: unknown;
}

export interface RunSummary {
  passed: number;
  failed: number;
  timeout: number;
  skipped: number;
  total: number;
}

export interface RunResult {
  test: { name: string; description?: string; totalActions: number };
  summary: RunSummary;
  steps: StepResult[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export type ProgressListener = (progress: {
  index: number;
  total: number;
  current: Recorded;
  step: StepResult;
}) => void;

export type RunMode = "auto" | "step";

export interface Player {
  run(test: Test, onProgress?: ProgressListener): Promise<RunResult>;
  abort(): void;
  /** Advance one step in step mode. No-op in auto mode. */
  next(): void;
  /** Switch between auto and step mid-run. In auto, any pending next() is
   *  effectively unblocked since the next-step gate is bypassed. */
  setMode(mode: RunMode): void;
  getMode(): RunMode;
}

export interface PlayerDeps {
  store: PlayerStore;
  iframe: () => HTMLIFrameElement | null;
  bridge: BridgeClient;
  drivers: Driver<Action>[];
  artifacts?: ArtifactCollector;
  /** Pause between steps (ms) — gives a human watching the replay time to
   *  follow what's happening. Default 150ms in UI mode. Set 0 for headless. */
  stepDelayMs?: number;
  /** "auto" runs the whole timeline back-to-back with stepDelayMs between
   *  steps. "step" blocks after each step until `player.next()` is called
   *  (interactive debugger UX). Default "auto". */
  mode?: RunMode;
}

function pickDriver(
  drivers: Driver<Action>[],
  kind: ActionKind,
): Driver<Action> | null {
  for (const d of drivers) {
    if (d.kinds.includes(kind)) return d;
  }
  return null;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal: AbortSignal,
): Promise<
  { ok: true; value: T } | { ok: false; reason: "timeout" | "abort" }
> {
  return new Promise((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: "abort" });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve({ ok: false, reason: "timeout" });
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve({ ok: true, value });
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve({
          ok: true,
          value: {
            ok: false,
            reason: (err as Error).message,
            durationMs: 0,
          } as T,
        });
      });
  });
}

function toStep(
  index: number,
  action: Recorded,
  durationMs: number,
  assertion: AssertionResult,
  observation?: unknown,
): StepResult {
  if (assertion.status === "pass") {
    return { index, action, status: "pass", durationMs, observation };
  }
  if (assertion.status === "skip") {
    return { index, action, status: "skip", durationMs };
  }
  return {
    index,
    action,
    status: "fail",
    durationMs,
    reason: assertion.reason,
    observation,
  };
}

export function createPlayer(deps: PlayerDeps): Player {
  const controller = new AbortController();
  let currentMode: RunMode = deps.mode ?? "auto";
  let nextResolver: (() => void) | null = null;

  function waitForNext(): Promise<void> {
    return new Promise<void>((resolve) => {
      nextResolver = resolve;
      controller.signal.addEventListener(
        "abort",
        () => {
          if (nextResolver) {
            nextResolver();
            nextResolver = null;
          }
        },
        { once: true },
      );
    });
  }

  function unblockNext() {
    if (nextResolver) {
      const r = nextResolver;
      nextResolver = null;
      r();
    }
  }

  return {
    abort() {
      controller.abort();
      unblockNext();
    },
    next() {
      unblockNext();
    },
    setMode(mode) {
      currentMode = mode;
      // Switching to auto unblocks the current pause so the run resumes.
      if (mode === "auto") unblockNext();
    },
    getMode() {
      return currentMode;
    },
    async run(test, onProgress) {
      const startedAt = new Date().toISOString();
      const t0 = performance.now();
      const steps: StepResult[] = [];

      // Pause emission so player-driven setters don't pollute the running
      // timeline. Bus stays in "recording" mode so observation listeners on
      // mcp.response / widget.render.complete still fire.
      recorder.suspend();

      // Subscribe to the bus for observation waits used by the mcp/widget drivers.
      const observationListeners = new Set<{
        predicate: (e: Recorded) => boolean;
        resolve: (e: Recorded | null) => void;
        timer: ReturnType<typeof setTimeout>;
      }>();
      const offEmit = recorder.onEmit((entry) => {
        for (const l of Array.from(observationListeners)) {
          if (l.predicate(entry)) {
            clearTimeout(l.timer);
            observationListeners.delete(l);
            l.resolve(entry);
          }
        }
      });

      const onObservation: DriverContext["onObservation"] = (
        predicate,
        timeoutMs,
      ) =>
        new Promise<Recorded | null>((resolve) => {
          const timer = setTimeout(() => {
            observationListeners.delete(record);
            resolve(null);
          }, timeoutMs);
          const record = { predicate, resolve, timer };
          observationListeners.add(record);
        });

      const ctx: DriverContext = {
        store: deps.store,
        iframe: deps.iframe,
        bridge: deps.bridge,
        signal: controller.signal,
        onObservation,
      };

      try {
        deps.store.setStudioMode("test");

        // Apply setup (ignore failures softly — preconditions caught structural issues).
        await applySetup(test, deps.store);

        // If the test was recorded with a widget snapshot, force a load and
        // wait for render.complete before stepping into the timeline.
        if (test.session.widget) {
          await deps.store.loadAll().catch(() => undefined);
        }

        for (let i = 0; i < test.session.timeline.length; i++) {
          if (controller.signal.aborted) break;
          const recordedAction = test.session.timeline[i];
          const driver = pickDriver(deps.drivers, recordedAction.kind);

          if (!driver) {
            const step = toStep(i, recordedAction, 0, { status: "skip" });
            step.reason = skipReasonForKind(recordedAction.kind);
            steps.push(step);
            onProgress?.({
              index: i,
              total: test.session.timeline.length,
              current: recordedAction,
              step,
            });
            continue;
          }

          const t = performance.now();
          const driveResult = await withTimeout(
            driver.drive(recordedAction as Action, ctx),
            timeoutFor(recordedAction.kind),
            controller.signal,
          );

          let assertion: AssertionResult;
          let observation: unknown;
          if (driveResult.ok) {
            const outcome = driveResult.value;
            observation = (outcome as { observation?: unknown }).observation;
            assertion = assertFor(recordedAction as Action)(
              recordedAction as Action,
              outcome,
              observation,
            );
          } else if (driveResult.reason === "abort") {
            assertion = { status: "skip" };
          } else {
            assertion = { status: "fail", reason: "step timed out" };
          }

          const step = toStep(
            i,
            recordedAction,
            performance.now() - t,
            assertion,
            observation,
          );
          steps.push(step);
          deps.artifacts?.rememberAction(recordedAction);
          if (step.status === "fail" || step.status === "timeout") {
            const snap = await deps.bridge.snapshot(1000).catch(() => null);
            deps.artifacts?.recordFailure(i, snap);
          } else if (
            recordedAction.kind === "widget.render" &&
            step.status === "pass"
          ) {
            // Capture a lightweight DOM snapshot so the report can render an
            // inline preview of what the widget looked like for this step.
            const snap = await deps.bridge.snapshot(500).catch(() => null);
            deps.artifacts?.recordPreview(i, snap);
          }
          onProgress?.({
            index: i,
            total: test.session.timeline.length,
            current: recordedAction,
            step,
          });
          if (i < test.session.timeline.length - 1) {
            if (currentMode === "step") {
              await waitForNext();
            } else {
              const delay = deps.stepDelayMs ?? 150;
              if (delay > 0) {
                await new Promise<void>((r) => {
                  const t = setTimeout(r, delay);
                  controller.signal.addEventListener(
                    "abort",
                    () => {
                      clearTimeout(t);
                      r();
                    },
                    { once: true },
                  );
                });
              }
            }
          }
        }
      } finally {
        offEmit();
        for (const l of observationListeners) clearTimeout(l.timer);
        observationListeners.clear();
        deps.store.setStudioMode("normal");
        recorder.resume();
      }

      const finishedAt = new Date().toISOString();
      const summary: RunSummary = {
        passed: steps.filter((s) => s.status === "pass").length,
        failed: steps.filter((s) => s.status === "fail").length,
        timeout: steps.filter((s) => s.status === "timeout").length,
        skipped: steps.filter((s) => s.status === "skip").length,
        total: steps.length,
      };
      return {
        test: {
          name: test.name,
          description: test.description,
          totalActions: test.session.timeline.length,
        },
        summary,
        steps,
        startedAt,
        finishedAt,
        durationMs: performance.now() - t0,
      };
    },
  };
}

async function applySetup(test: Test, store: PlayerStore): Promise<void> {
  const { connect, config } = test.session.setup;
  if (connect.url) store.setProxyUrl(connect.url);
  store.setAuthMethod(connect.auth.method);
  if (connect.auth.method === "bearer" || connect.auth.method === "oauth") {
    if (connect.auth.token && connect.auth.token !== "<<from-env>>") {
      store.setToken(connect.auth.token);
      store.saveToken();
    }
  } else if (connect.auth.method === "custom") {
    store.setOAuthCustomHeaders(JSON.stringify(connect.auth.headers));
  }
  store.setPlatform(config.platform);
  store.setTheme(config.theme);
  store.setLocale(config.locale);
  store.setDisplayMode(config.displayMode);
  if ("preset" in config.viewport) {
    store.setViewportPreset(config.viewport.preset);
  } else {
    store.setViewportPreset("custom");
    store.setViewportCustom({
      width: config.viewport.width,
      height: config.viewport.height,
    });
  }
  // Strict mode is a precondition handled by caller — don't toggle it here.
}
