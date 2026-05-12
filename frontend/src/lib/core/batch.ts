/**
 * Sequential batch runner. Loops `engine.run()` over a list of recorded
 * traces and produces one RunResultEntry per trace. Respects an outer
 * AbortSignal so the caller can stop mid-batch.
 *
 * Serial only: widget iframes share DOM state and the bridge install flag,
 * so running tests in parallel would race. The trade-off is total wall
 * time scales linearly with the catalog size.
 */

import { run as runEngine, type EngineDeps } from "./engine";
import { diff } from "./differ";
import { resolveRules } from "./rules";
import type { Trace } from "./types";
import type {
  RunResultEntry,
  RunResultStatus,
} from "@/lib/tests/run-result-schema";

export interface BatchTraceInput {
  /** Filesystem slug used by the tests API (so the result can be linked
   *  back to the source test). */
  testFsName: string;
  trace: Trace;
}

export interface BatchDeps {
  signal: AbortSignal;
  /** Returns per-test EngineDeps minus `signal` (which the batch
   *  manages). Called fresh for each test so callers can rebuild
   *  drivers/bridge between tests if needed. */
  buildDeps: (trace: Trace) => Omit<EngineDeps, "signal">;
  onTestStart?: (index: number, input: BatchTraceInput, total: number) => void;
  onTestDone?: (index: number, entry: RunResultEntry) => void;
}

export async function runBatch(
  inputs: BatchTraceInput[],
  deps: BatchDeps,
): Promise<RunResultEntry[]> {
  const out: RunResultEntry[] = [];
  for (let i = 0; i < inputs.length; i++) {
    if (deps.signal.aborted) break;
    const input = inputs[i];
    deps.onTestStart?.(i, input, inputs.length);
    const entry = await runOne(input, deps);
    out.push(entry);
    deps.onTestDone?.(i, entry);
  }
  return out;
}

async function runOne(
  input: BatchTraceInput,
  deps: BatchDeps,
): Promise<RunResultEntry> {
  const { trace, testFsName } = input;
  const childCtrl = new AbortController();
  const onAbort = () => childCtrl.abort();
  deps.signal.addEventListener("abort", onAbort, { once: true });
  const startedAt = performance.now();
  try {
    const perTest = deps.buildDeps(trace);
    const replayed = await runEngine(trace, {
      ...perTest,
      signal: childCtrl.signal,
    });
    const verdict = diff(trace, replayed, resolveRules(trace));
    const status: RunResultStatus = verdict.ok ? "passed" : "failed";
    return {
      testName: trace.name,
      testFsName,
      status,
      durationMs: performance.now() - startedAt,
      recorded: trace,
      replayed,
      verdict,
    };
  } catch (e) {
    return {
      testName: trace.name,
      testFsName,
      status: "errored",
      durationMs: performance.now() - startedAt,
      recorded: trace,
      replayed: trace,
      verdict: { ok: false, drifts: [] },
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    deps.signal.removeEventListener("abort", onAbort);
  }
}
