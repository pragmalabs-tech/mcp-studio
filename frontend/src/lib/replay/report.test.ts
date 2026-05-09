import { describe, expect, it } from "vitest";
import { buildReport, REPORT_VERSION, reportFilename } from "./report";
import type { RunResult } from "./player";

const baseRun: RunResult = {
  test: { name: "Search flow", description: "tests search", totalActions: 3 },
  summary: { passed: 2, failed: 1, timeout: 0, skipped: 0, total: 3 },
  steps: [
    {
      index: 0,
      action: {
        relMs: 0,
        kind: "sidebar.select",
        selection: { type: "tool", name: "x" },
      },
      status: "pass",
      durationMs: 5,
    },
    {
      index: 1,
      action: {
        relMs: 100,
        kind: "mcp.request",
        id: 1,
        source: "user",
        method: "tools/call",
        params: {},
      },
      status: "pass",
      durationMs: 50,
    },
    {
      index: 2,
      action: {
        relMs: 300,
        kind: "widget.dom.click",
        selectors: { testid: "btn" },
        mutated: true,
      },
      status: "fail",
      durationMs: 200,
      reason: "ack ok=false",
    },
  ],
  startedAt: "2026-05-09T12:00:00Z",
  finishedAt: "2026-05-09T12:00:01Z",
  durationMs: 1000,
};

describe("buildReport", () => {
  it("produces a versioned report with the right summary counts", () => {
    const r = buildReport({
      runResult: baseRun,
      artifacts: { failures: {}, previews: {} },
      preconditions: { strictModeOk: true, iframeReady: true },
    });
    expect(r.version).toBe(REPORT_VERSION);
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.summary.passed).toBe(2);
    expect(r.summary.failed).toBe(1);
    expect(r.steps).toHaveLength(3);
    expect(r.test.name).toBe("Search flow");
  });

  it("captures preconditions and env", () => {
    const r = buildReport({
      runResult: baseRun,
      artifacts: { failures: {}, previews: {} },
      preconditions: { strictModeOk: false, iframeReady: true },
      env: {
        studioVersion: "1.2.3",
        userAgent: "ua/1",
        viewport: { w: 100, h: 200 },
      },
    });
    expect(r.preconditions.strictModeOk).toBe(false);
    expect(r.env.studioVersion).toBe("1.2.3");
    expect(r.env.viewport).toEqual({ w: 100, h: 200 });
  });

  it("includes artifacts dictionary verbatim", () => {
    const a = {
      failures: {
        2: {
          domSnapshot: "<x/>",
          errors: ["e1"],
          contextWindow: [],
        },
      },
      previews: {},
    };
    const r = buildReport({
      runResult: baseRun,
      artifacts: a,
      preconditions: { strictModeOk: true, iframeReady: true },
    });
    expect(r.artifacts).toBe(a);
  });
});

describe("reportFilename", () => {
  it("slugifies test name and appends a stub of runId", () => {
    const r = buildReport({
      runResult: baseRun,
      artifacts: { failures: {}, previews: {} },
      preconditions: { strictModeOk: true, iframeReady: true },
    });
    const name = reportFilename(r);
    expect(name).toMatch(/^search-flow-[0-9a-f]{8}$/);
  });

  it("falls back to 'report' if test name is unsluggable", () => {
    const r = buildReport({
      runResult: { ...baseRun, test: { ...baseRun.test, name: "@@@" } },
      artifacts: { failures: {}, previews: {} },
      preconditions: { strictModeOk: true, iframeReady: true },
    });
    expect(reportFilename(r)).toMatch(/^report-[0-9a-f]{8}$/);
  });
});
