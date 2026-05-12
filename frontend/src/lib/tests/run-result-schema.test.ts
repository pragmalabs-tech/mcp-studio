import { describe, expect, it } from "vitest";
import { newRunId, summarize, type RunResultEntry } from "./run-result-schema";

function entry(
  status: RunResultEntry["status"],
  durationMs: number,
): RunResultEntry {
  return {
    testName: "t",
    testFsName: "t",
    status,
    durationMs,
    recorded: { steps: [] } as never,
    replayed: { steps: [] } as never,
    verdict: { ok: status === "passed", drifts: [] },
  };
}

describe("newRunId", () => {
  it("encodes the start time as a sortable prefix", () => {
    const id = newRunId(Date.UTC(2026, 4, 12, 15, 30, 45));
    expect(id.startsWith("20260512_153045_")).toBe(true);
    expect(id).toMatch(/^\d{8}_\d{6}_[a-z0-9]{4}$/);
  });

  it("yields unique ids for the same instant", () => {
    const seen = new Set<string>();
    const now = Date.now();
    for (let i = 0; i < 100; i++) seen.add(newRunId(now));
    expect(seen.size).toBeGreaterThan(90);
  });
});

describe("summarize", () => {
  it("aggregates counts and total duration", () => {
    const counts = summarize([
      entry("passed", 10),
      entry("passed", 15),
      entry("failed", 20),
      entry("errored", 30),
    ]);
    expect(counts).toEqual({
      total: 4,
      passed: 2,
      failed: 1,
      errored: 1,
      durationMs: 75,
    });
  });

  it("returns zeros for an empty batch", () => {
    expect(summarize([])).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      durationMs: 0,
    });
  });
});
