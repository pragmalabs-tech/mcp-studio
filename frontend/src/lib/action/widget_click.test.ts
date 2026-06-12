// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

// snapshotCenter uses getWidgetIframe (DOM lookup) which won't find elements in
// the test environment — mock it so takeSnapshot/getResult work with test data.
const mockGetResult = vi.hoisted(() =>
  vi
    .fn<
      () =>
        | import("@/components/studio/preview/snapshot/snapshot").WidgetSnapshot
        | null
    >()
    .mockReturnValue(null),
);
vi.mock("../../components/studio/preview/snapshot/snapshot-center", () => ({
  captureWidgetSnapshot: vi.fn().mockReturnValue(null),
  snapshotCenter: {
    register: vi.fn(),
    takeSnapshot: vi.fn(),
    getResult: mockGetResult,
    unregister: vi.fn(),
    waitFor: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/lib/studio/stores/widget-store", () => {
  const state: Record<string, unknown> = {
    logAction: vi.fn(),
    widgets: {} as Record<string, unknown>,
    _iframeRef: null as { contentDocument: Document | null } | null,
    openClick: null,
  };
  return {
    useWidgetStore: {
      getState: () => state,
      setState: (patch: object | ((s: object) => object)) => {
        const next = typeof patch === "function" ? patch(state) : patch;
        Object.assign(state, next);
      },
    },
  };
});

import { WidgetClickAction } from "./widget_click";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { ToolsCallEvent } from "@/lib/event/tools_call";
import { WidgetRenderEvent } from "@/lib/event/widget_render";

function docOf(html: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
}

function setupStore(html: string, widgetId = "w1") {
  const doc = docOf(html);
  const fakeIframe = { contentDocument: doc };
  const s = useWidgetStore.getState() as unknown as Record<string, unknown>;
  s.logAction = vi.fn();
  s.widgets = {
    [widgetId]: {
      id: widgetId,
      originalHtml: "",
      injectedHtml: "",
      mock: {},
      waitMs: 0,
      snapshot: null,
    },
  };
  s._iframeRef = fakeIframe as unknown as Record<string, unknown>;
  s.openClick = null;
  return { doc };
}

describe("WidgetClickAction", () => {
  beforeEach(() => {
    setupStore("");
  });

  it("sets result.success=false when the iframe isn't mounted", async () => {
    const s = useWidgetStore.getState() as unknown as Record<string, unknown>;
    s._iframeRef = null;
    const action = new WidgetClickAction("missing", ['[data-testid="x"]']);
    await action.execute();
    expect(action.result?.success).toBe(false);
    expect(action.result?.error?.message).toBe("iframe not mounted");
  });

  it("sets result.success=false when no candidate matches", async () => {
    setupStore(`<button data-testid="other">No</button>`);
    const action = new WidgetClickAction("w1", ['[data-testid="x"]']);
    await action.execute();
    expect(action.result?.success).toBe(false);
    expect(action.result?.error?.message).toBe("element not found");
  });

  it("falls back through the candidate list and records which one matched", async () => {
    setupStore(`<button id="real">Save</button>`);
    const snap = {
      id: "w1",
      html: '<!DOCTYPE html><html><body><button id="real">Save</button></body></html>',
      createdAt: new Date().toISOString(),
    };
    const action = new WidgetClickAction("w1", [
      '[data-testid="missing"]',
      "#real",
      "button",
    ]);
    const settled = action.execute({ snapshot: snap });
    // Action is now hanging in the settle window. Close it.
    action.close();
    await settled;

    expect(action.result?.success).toBe(true);
    const data = action.result?.data as {
      matchedSelector: string;
      matchedIndex: number;
      snapshot: string;
    };
    expect(data.matchedSelector).toBe("#real");
    expect(data.matchedIndex).toBe(1);
    expect(data.snapshot).toContain('<button id="real">');
  });

  it("registers itself as the open click while execute is in flight", async () => {
    setupStore(`<button id="x">A</button>`);
    const action = new WidgetClickAction("w1", ["#x"]);
    const settled = action.execute();
    // While execute() is awaiting close(), openClick should be set.
    await new Promise((r) => setTimeout(r, 5));
    expect(useWidgetStore.getState().openClick).toBe(action);
    action.close();
    await settled;
    expect(useWidgetStore.getState().openClick).toBeNull();
  });

  it("change() aggregates tools/call counters from captured events", async () => {
    setupStore(`<button id="x">A</button>`);
    const action = new WidgetClickAction("w1", ["#x"]);
    const settled = action.execute();

    // Simulate bridge pushing two tool-call events into the action's bucket.
    action.events.push(
      new ToolsCallEvent("foo", { a: 1 }, { success: true, data: {} }),
    );
    action.events.push(
      new ToolsCallEvent("foo", { a: 2 }, { success: true, data: {} }),
    );
    action.events.push(
      new ToolsCallEvent(
        "bar",
        {},
        { success: false, error: { message: "x" } },
      ),
    );

    action.close();
    await settled;

    expect(action.change()).toEqual({
      widgets: { w1: { renderCount: 0, clickCount: 1 } },
      tools: {
        foo: { callCount: 2 },
        bar: { callCount: 1 },
      },
      network: { requestCount: 3, responseCount: 2, errorCount: 1 },
    });
  });

  it("change() counts widget/render events alongside the click", async () => {
    setupStore(`<button id="x">A</button>`);
    const action = new WidgetClickAction("w1", ["#x"]);
    const settled = action.execute();

    action.events.push(
      new WidgetRenderEvent("w2", "ui://widget/foo", { success: true }),
    );

    action.close();
    await settled;

    const change = action.change();
    expect(change.widgets).toEqual({
      w1: { renderCount: 0, clickCount: 1 },
      w2: { renderCount: 1, clickCount: 0 },
    });
    // No tools/call events → no tools/network slices on the change.
    expect(change.tools).toBeUndefined();
    expect(change.network).toBeUndefined();
  });

  it("declares assertable points covering success, matched, errorMessage", () => {
    const keys = WidgetClickAction.assertablePoints.map((p) => p.key);
    expect(keys).toContain("success");
    expect(keys).toContain("matched");
    expect(keys).toContain("errorMessage");
  });
});
