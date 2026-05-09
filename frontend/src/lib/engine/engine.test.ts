import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "./engine";
import { recorder } from "@/lib/recorder/bus";
import type { Driver } from "./drivers/types";
import type { Action, Test } from "@/lib/recorder/schema";
import type { BridgeClient } from "./bridge-client";

function fakeStore() {
  const calls: string[] = [];
  return {
    calls,
    setStudioMode: (m: string) => calls.push(`setStudioMode:${m}`),
    setStrictMode: () => calls.push("setStrictMode"),
    setProxyUrl: () => calls.push("setProxyUrl"),
    setAuthMethod: () => calls.push("setAuthMethod"),
    setToken: () => calls.push("setToken"),
    saveToken: () => calls.push("saveToken"),
    setOAuthCustomHeaders: () => calls.push("setOAuthCustomHeaders"),
    setPlatform: () => calls.push("setPlatform"),
    setTheme: () => calls.push("setTheme"),
    setLocale: () => calls.push("setLocale"),
    setDisplayMode: () => calls.push("setDisplayMode"),
    setViewportPreset: () => calls.push("setViewportPreset"),
    setViewportCustom: () => calls.push("setViewportCustom"),
    setEditorValue: () => calls.push("setEditorValue"),
    select: () => calls.push("select"),
    loadAll: async () => {
      calls.push("loadAll");
    },
    loadWidget: async () => {
      calls.push("loadWidget");
    },
    applyMock: () => calls.push("applyMock"),
    execute: async () => {
      calls.push("execute");
    },
    getState: () => ({
      strictMode: false,
      tools: [],
      resources: [],
      selected: null,
    }),
  };
}

function fakeBridge(): BridgeClient {
  return {
    dispatch: async () => ({ ok: true, mutated: true }),
    ping: async () => true,
    snapshot: async () => ({ html: "", errors: [] }),
    awaitRenderComplete: async () => ({
      bodyChars: 100,
      hasRuntimeErrors: false,
      handshakeOk: true,
      renderDurationMs: 10,
    }),
    destroy: () => {},
  };
}

const passingDriver: Driver<Action> = {
  kinds: ["sidebar.select", "config.update", "editor.set_args"],
  drive: async () => ({ ok: true, durationMs: 1 }),
};

const failingDriver: Driver<Action> = {
  kinds: ["mcp.request"],
  drive: async () => ({ ok: false, reason: "boom", durationMs: 1 }),
};

function buildTest(timeline: Action[]): Test {
  return {
    id: "t1",
    name: "fake",
    createdAt: new Date().toISOString(),
    session: {
      version: 1,
      capturedAt: new Date().toISOString(),
      studioVersion: "0.1.0",
      setup: {
        connect: {
          url: "http://localhost",
          auth: { method: "bearer", token: "" },
        },
        config: {
          platform: "claude",
          theme: "dark",
          displayMode: "inline",
          locale: "en-US",
          viewport: { preset: "desktop" },
          strictMode: false,
        },
      },
      timeline: timeline.map((a, i) => ({ ...(a as Action), relMs: i * 10 })),
    },
  };
}

beforeEach(() => {
  if (recorder.mode === "recording") recorder.stop();
});

describe("Player loop", () => {
  it("runs all steps in order and reports passes", async () => {
    const store = fakeStore();
    const engine = createEngine({
      store: store as unknown as Parameters<typeof createEngine>[0]["store"],
      iframe: () => null,
      bridge: fakeBridge(),
      drivers: [passingDriver],
    });
    const test = buildTest([
      { kind: "config.update", patch: { theme: "light" } },
      { kind: "sidebar.select", selection: { type: "tool", name: "x" } },
      { kind: "editor.set_args", value: { a: 1 } },
    ]);
    const result = await engine.run(test);
    expect(result.summary.total).toBe(3);
    expect(result.summary.passed).toBe(3);
    expect(result.summary.failed).toBe(0);
    expect(store.calls).toContain("setStudioMode:test");
    expect(store.calls).toContain("setStudioMode:normal");
  });

  it("marks all unknown-kind steps as skip when no driver matches", async () => {
    const store = fakeStore();
    const engine = createEngine({
      store: store as unknown as Parameters<typeof createEngine>[0]["store"],
      iframe: () => null,
      bridge: fakeBridge(),
      drivers: [], // no drivers — every step skips
    });
    const test = buildTest([
      { kind: "config.update", patch: { theme: "dark" } },
      { kind: "mcp.request", id: 1, source: "user", method: "x", params: {} },
    ]);
    const result = await engine.run(test);
    expect(result.summary.skipped).toBe(2);
    expect(result.summary.passed).toBe(0);
    expect(result.summary.failed).toBe(0);
  });

  it("records driver failures as fail steps", async () => {
    const store = fakeStore();
    const engine = createEngine({
      store: store as unknown as Parameters<typeof createEngine>[0]["store"],
      iframe: () => null,
      bridge: fakeBridge(),
      drivers: [failingDriver],
    });
    const test = buildTest([
      { kind: "mcp.request", id: 1, source: "user", method: "x", params: {} },
    ]);
    const result = await engine.run(test);
    expect(result.summary.failed).toBe(1);
    expect(result.steps[0].reason).toBe("boom");
  });

  it("times out a slow driver", async () => {
    const store = fakeStore();
    const slowDriver: Driver<Action> = {
      kinds: ["mcp.request"],
      drive: () => new Promise(() => undefined), // never resolves
    };
    const engine = createEngine({
      store: store as unknown as Parameters<typeof createEngine>[0]["store"],
      iframe: () => null,
      bridge: fakeBridge(),
      drivers: [slowDriver],
    });
    vi.useFakeTimers();
    const test = buildTest([
      { kind: "mcp.request", id: 1, source: "user", method: "x", params: {} },
    ]);
    const promise = engine.run(test);
    await vi.advanceTimersByTimeAsync(11_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.summary.failed).toBe(1);
    expect(result.steps[0].reason).toMatch(/time/);
  });

  it("aborts cleanly mid-run", async () => {
    const store = fakeStore();
    let started = 0;
    const slowDriver: Driver<Action> = {
      kinds: ["mcp.request"],
      drive: () => {
        started++;
        return new Promise(() => undefined);
      },
    };
    const engine = createEngine({
      store: store as unknown as Parameters<typeof createEngine>[0]["store"],
      iframe: () => null,
      bridge: fakeBridge(),
      drivers: [slowDriver],
    });
    const test = buildTest([
      { kind: "mcp.request", id: 1, source: "user", method: "x", params: {} },
      { kind: "mcp.request", id: 2, source: "user", method: "y", params: {} },
    ]);
    const promise = engine.run(test);
    setTimeout(() => engine.abort(), 5);
    const result = await promise;
    expect(started).toBeLessThanOrEqual(2);
    expect(result.summary.skipped + result.summary.failed).toBeGreaterThan(0);
  });
});
