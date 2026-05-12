import { describe, expect, it, vi } from "vitest";
import { runBatch, type BatchTraceInput } from "./batch";
import type { Trace } from "./types";
import * as engine from "./engine";

function makeTrace(name: string): Trace {
  return {
    schemaVersion: 1,
    id: `id_${name}`,
    name,
    setup: { url: "http://localhost:3000" },
    initialState: { connections: {}, sessions: {}, widgets: {} },
    steps: [],
  } as unknown as Trace;
}

function input(name: string): BatchTraceInput {
  return { testFsName: name, trace: makeTrace(name) };
}

describe("runBatch", () => {
  it("runs tests serially and preserves input order", async () => {
    const order: string[] = [];
    const spy = vi.spyOn(engine, "run").mockImplementation(async (trace) => {
      order.push(trace.name);
      await new Promise((r) => setTimeout(r, 5));
      return trace;
    });

    const ctrl = new AbortController();
    const out = await runBatch([input("a"), input("b"), input("c")], {
      signal: ctrl.signal,
      buildDeps: () => ({}),
    });

    expect(order).toEqual(["a", "b", "c"]);
    expect(out.map((e) => e.testName)).toEqual(["a", "b", "c"]);
    expect(out.every((e) => e.status === "passed")).toBe(true);
    spy.mockRestore();
  });

  it("classifies a thrown engine as errored, not failed", async () => {
    const spy = vi
      .spyOn(engine, "run")
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation(async (t) => t);

    const ctrl = new AbortController();
    const out = await runBatch([input("a"), input("b")], {
      signal: ctrl.signal,
      buildDeps: () => ({}),
    });

    expect(out[0].status).toBe("errored");
    expect(out[0].error).toBe("boom");
    expect(out[1].status).toBe("passed");
    spy.mockRestore();
  });

  it("short-circuits when the outer signal aborts between tests", async () => {
    let callCount = 0;
    const spy = vi.spyOn(engine, "run").mockImplementation(async (trace) => {
      callCount++;
      return trace;
    });

    const ctrl = new AbortController();
    const onTestDone = vi.fn(() => {
      if (callCount === 1) ctrl.abort();
    });

    const out = await runBatch([input("a"), input("b"), input("c")], {
      signal: ctrl.signal,
      buildDeps: () => ({}),
      onTestDone,
    });

    expect(callCount).toBe(1);
    expect(out).toHaveLength(1);
    expect(out[0].testName).toBe("a");
    spy.mockRestore();
  });

  it("propagates the outer signal abort into the per-test engine signal", async () => {
    let capturedSignal: AbortSignal | null = null;
    const spy = vi
      .spyOn(engine, "run")
      .mockImplementation(async (trace, deps) => {
        capturedSignal = deps.signal;
        return trace;
      });

    const ctrl = new AbortController();
    await runBatch([input("a")], {
      signal: ctrl.signal,
      buildDeps: () => ({}),
    });

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);
    spy.mockRestore();
  });
});
