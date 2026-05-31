// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/studio/stores/widget-store", () => {
  const state: Record<string, unknown> = {
    logAction: vi.fn(),
    widgets: {} as Record<string, unknown>,
    _iframeRef: null as { contentDocument: Document | null } | null,
    openTextInput: null,
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

import { WidgetTextInputAction } from "./widget_text_input";
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
  s.widgets = { [widgetId]: { html: "", mock: {}, waitMs: 0, snapshot: null } };
  s._iframeRef = fakeIframe as unknown as Record<string, unknown>;
  s.openTextInput = null;
  return { doc };
}

describe("WidgetTextInputAction", () => {
  beforeEach(() => {
    setupStore("");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── execute() ────────────────────────────────────────────────────────────

  it("sets result.success=false when the iframe isn't mounted", async () => {
    const s = useWidgetStore.getState() as unknown as Record<string, unknown>;
    s._iframeRef = null;
    const action = new WidgetTextInputAction(
      "w1",
      ['input[name="q"]'],
      "hello",
    );
    await action.execute();
    expect(action.result?.success).toBe(false);
    expect(action.result?.error?.message).toBe("iframe not mounted");
  });

  it("sets result.success=false when no candidate matches", async () => {
    setupStore(`<input name="other" />`);
    const action = new WidgetTextInputAction(
      "w1",
      ['input[name="q"]'],
      "hello",
    );
    await action.execute();
    expect(action.result?.success).toBe(false);
    expect(action.result?.error?.message).toBe("element not found");
  });

  it("falls back through the candidate list and records which matched", async () => {
    setupStore(`<textarea id="msg"></textarea>`);
    const action = new WidgetTextInputAction(
      "w1",
      ['input[name="missing"]', "#msg", "textarea"],
      "hello world",
    );
    const settled = action.execute();
    action.close();
    await settled;

    expect(action.result?.success).toBe(true);
    const data = action.result?.data as {
      matchedSelector: string;
      matchedIndex: number;
      snapshot: string;
    };
    expect(data.matchedSelector).toBe("#msg");
    expect(data.matchedIndex).toBe(1);
    expect(data.snapshot).toContain('<textarea id="msg">');
  });

  it("sets the element value and dispatches input + change events", async () => {
    setupStore(`<input id="q" />`);
    const doc = (
      useWidgetStore.getState() as unknown as {
        _iframeRef: { contentDocument: Document };
      }
    )._iframeRef.contentDocument;
    const input = doc.getElementById("q") as HTMLInputElement;

    const inputFired = vi.fn();
    const changeFired = vi.fn();
    input.addEventListener("input", inputFired);
    input.addEventListener("change", changeFired);

    const action = new WidgetTextInputAction("w1", ["#q"], "typed text");
    const settled = action.execute();
    action.close();
    await settled;

    expect(input.value).toBe("typed text");
    expect(inputFired).toHaveBeenCalledOnce();
    expect(changeFired).toHaveBeenCalledOnce();
  });

  it("registers itself as openTextInput while execute is in flight", async () => {
    setupStore(`<input id="q" />`);
    const action = new WidgetTextInputAction("w1", ["#q"], "hi");
    const settled = action.execute();

    await Promise.resolve(); // let execute() reach the settle await
    expect(useWidgetStore.getState().openTextInput).toBe(action);

    action.close();
    await settled;
    expect(useWidgetStore.getState().openTextInput).toBeNull();
  });

  // ── recordFromUserInput + debounce ────────────────────────────────────────

  it("recordFromUserInput resolves after DEBOUNCE_MS with no further updates", async () => {
    const { doc } = setupStore(`<input id="q" />`);
    const action = new WidgetTextInputAction("w1", ["#q"]);

    const recording = action.recordFromUserInput(doc, {
      matchedSelector: "#q",
      matchedIndex: 0,
      initialValue: "abc",
    });

    // Should still be open just before the debounce fires
    vi.advanceTimersByTime(WidgetTextInputAction.DEBOUNCE_MS - 1);
    expect(useWidgetStore.getState().openTextInput).toBe(action);

    // Fire the debounce
    vi.advanceTimersByTime(1);
    await recording;

    expect(action.result?.success).toBe(true);
    expect(action.data.value).toBe("abc");
    expect(useWidgetStore.getState().openTextInput).toBeNull();
  });

  it("updateValue resets the debounce timer and captures the latest value", async () => {
    const { doc } = setupStore(`<input id="q" />`);
    const action = new WidgetTextInputAction("w1", ["#q"]);

    const recording = action.recordFromUserInput(doc, {
      matchedSelector: "#q",
      matchedIndex: 0,
      initialValue: "a",
    });

    // User keeps typing — each call resets the debounce
    vi.advanceTimersByTime(600);
    action.updateValue("ab");
    vi.advanceTimersByTime(600);
    action.updateValue("abc");
    vi.advanceTimersByTime(600);
    // Not yet resolved — last update was 600ms ago, debounce is 800ms
    expect(useWidgetStore.getState().openTextInput).toBe(action);

    // Let the debounce fire
    vi.advanceTimersByTime(200);
    await recording;

    expect(action.data.value).toBe("abc");
    expect(action.result?.success).toBe(true);
  });

  it("manual close() during recordFromUserInput finalizes immediately", async () => {
    const { doc } = setupStore(`<input id="q" />`);
    const action = new WidgetTextInputAction("w1", ["#q"]);

    const recording = action.recordFromUserInput(doc, {
      matchedSelector: "#q",
      matchedIndex: 0,
      initialValue: "partial",
    });

    action.close();
    await recording;

    expect(action.result?.success).toBe(true);
    expect(action.data.value).toBe("partial");
  });

  it("close() is idempotent — calling it twice does not throw", async () => {
    const { doc } = setupStore(`<input id="q" />`);
    const action = new WidgetTextInputAction("w1", ["#q"]);
    const recording = action.recordFromUserInput(doc, {
      matchedSelector: "#q",
      matchedIndex: 0,
      initialValue: "x",
    });
    action.close();
    action.close(); // second call is a no-op
    await recording;
    expect(action.result?.success).toBe(true);
  });

  // ── change() ─────────────────────────────────────────────────────────────

  it("change() tracks inputCount=1 for the typed widget", async () => {
    setupStore(`<input id="q" />`);
    const action = new WidgetTextInputAction("w1", ["#q"], "hello");
    const settled = action.execute();
    action.close();
    await settled;

    expect(action.change()).toEqual({
      widgets: { w1: { renderCount: 0, clickCount: 0, inputCount: 1 } },
    });
  });

  it("change() aggregates tools/call counters from captured events", async () => {
    setupStore(`<input id="q" />`);
    const action = new WidgetTextInputAction("w1", ["#q"], "hi");
    const settled = action.execute();

    action.events.push(
      new ToolsCallEvent("search", { q: "hi" }, { success: true, data: {} }),
    );
    action.events.push(
      new ToolsCallEvent("search", { q: "hi2" }, { success: true, data: {} }),
    );
    action.events.push(
      new ToolsCallEvent(
        "validate",
        {},
        { success: false, error: { message: "bad" } },
      ),
    );

    action.close();
    await settled;

    expect(action.change()).toEqual({
      widgets: { w1: { renderCount: 0, clickCount: 0, inputCount: 1 } },
      tools: {
        search: { callCount: 2 },
        validate: { callCount: 1 },
      },
      network: { requestCount: 3, responseCount: 2, errorCount: 1 },
    });
  });

  it("change() counts widget/render events alongside the input", async () => {
    setupStore(`<input id="q" />`);
    const action = new WidgetTextInputAction("w1", ["#q"], "hi");
    const settled = action.execute();

    action.events.push(
      new WidgetRenderEvent("w2", "ui://widget/results", { success: true }),
    );

    action.close();
    await settled;

    const change = action.change();
    expect(change.widgets).toEqual({
      w1: { renderCount: 0, clickCount: 0, inputCount: 1 },
      w2: { renderCount: 1, clickCount: 0, inputCount: 0 },
    });
    expect(change.tools).toBeUndefined();
    expect(change.network).toBeUndefined();
  });

  // ── assertable points ─────────────────────────────────────────────────────

  it("declares assertable points covering success, matched, errorMessage", () => {
    const keys = WidgetTextInputAction.assertablePoints.map((p) => p.key);
    expect(keys).toContain("success");
    expect(keys).toContain("matched");
    expect(keys).toContain("errorMessage");
  });
});
