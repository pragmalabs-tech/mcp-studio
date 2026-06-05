// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WidgetInputEvent } from "./types";

// ── Mocks ──────────────────────────────────────────────────────────────────
// The segmenter is pure policy: it decides which Action to build and drives
// its open-window. We mock the Action classes as spies so the tests assert the
// *decision* (which action, with what args, and which lifecycle calls) without
// exercising real settle windows or DOM dispatch.

const h = vi.hoisted(() => {
  const recorderState = { capturing: true };
  const busState = { active: null as unknown };
  return {
    recorderState,
    busState,
    recorder: {
      isCapturing: vi.fn(() => recorderState.capturing),
      record: vi.fn(),
    },
    eventBus: {
      setActive: vi.fn((a: unknown) => {
        busState.active = a;
      }),
      current: vi.fn(() => busState.active),
    },
  };
});
const { recorderState, recorder, eventBus } = h;
vi.mock("@/lib/recorder/recorder", () => ({ recorder: h.recorder }));
vi.mock("@/lib/event", () => ({ eventBus: h.eventBus }));

vi.mock("@/lib/action/widget_click", () => ({
  WidgetClickAction: vi.fn(function (
    this: Record<string, unknown>,
    widgetId: string,
    candidates: string[],
    fallback?: string,
    detail = 1,
  ) {
    this.data = { widgetId, candidates, fallback, detail };
    this.recordFromUserClick = vi.fn().mockResolvedValue(undefined);
    this.change = vi.fn(() => ({ widgets: {} }));
    this.markRecorded = vi.fn();
    this.setDetail = vi.fn();
    this.close = vi.fn();
  }),
}));

vi.mock("@/lib/action/widget_text_input", () => ({
  WidgetTextInputAction: vi.fn(function (
    this: Record<string, unknown>,
    widgetId: string,
    candidates: string[],
    value: string,
  ) {
    this.data = { widgetId, candidates, value };
    this.recordFromUserInput = vi.fn().mockResolvedValue(undefined);
    this.change = vi.fn(() => ({ widgets: {} }));
    this.markRecorded = vi.fn();
  }),
}));

vi.mock("@/lib/action/widget_canvas_click", () => ({
  WidgetCanvasClickAction: vi.fn(function (
    this: Record<string, unknown>,
    widgetId: string,
    canvas: unknown,
    nx: number,
    ny: number,
    detail = 1,
  ) {
    this.data = { widgetId, canvas, nx, ny, detail };
    this.recordFromUserClick = vi.fn().mockResolvedValue(undefined);
    this.change = vi.fn(() => ({ widgets: {} }));
    this.markRecorded = vi.fn();
    this.setDetail = vi.fn();
    this.close = vi.fn();
  }),
}));

const storeState: Record<string, unknown> = {};
vi.mock("@/lib/studio/stores/widget-store", () => ({
  useWidgetStore: { getState: () => storeState },
}));

import { handleWidgetInput } from "./segmenter";
import { WidgetClickAction } from "@/lib/action/widget_click";
import { WidgetTextInputAction } from "@/lib/action/widget_text_input";
import { WidgetCanvasClickAction } from "@/lib/action/widget_canvas_click";

const ClickMock = WidgetClickAction as unknown as ReturnType<typeof vi.fn>;
const TextMock = WidgetTextInputAction as unknown as ReturnType<typeof vi.fn>;
const CanvasMock = WidgetCanvasClickAction as unknown as ReturnType<
  typeof vi.fn
>;

function fakeDoc(): Document {
  return new DOMParser().parseFromString(
    "<!doctype html><html></html>",
    "text/html",
  );
}

function resetStore() {
  storeState.activeWidgetId = "w1";
  storeState._iframeRef = { contentDocument: fakeDoc() };
  storeState.openClick = null;
  storeState.openTextInput = null;
}

function clickEvt(
  over: Partial<WidgetInputEvent["target"]> = {},
): WidgetInputEvent {
  return {
    kind: "click",
    target: { candidates: ["#btn"], isTextLike: false, text: "Save", ...over },
  };
}

function keyEvt(
  key: string,
  over: Partial<WidgetInputEvent["target"]> = {},
): WidgetInputEvent {
  return {
    kind: "keyup",
    key,
    target: {
      candidates: ['input[name="q"]'],
      isTextLike: true,
      value: "hi",
      ...over,
    },
  };
}

function canvasEvt(over: Partial<WidgetInputEvent> = {}): WidgetInputEvent {
  return {
    kind: "canvas_click",
    canvas: { selector: "canvas.board", index: 0, total: 1 },
    nx: 0.5,
    ny: 0.25,
    ...over,
  };
}

/** Flush the microtask queue so recordFromUser*().then(...) runs. */
const flush = () => Promise.resolve();

describe("handleWidgetInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorderState.capturing = true;
    h.busState.active = null;
    resetStore();
  });

  // ── gating ─────────────────────────────────────────────────────────────
  it("ignores events when the recorder isn't capturing", () => {
    recorderState.capturing = false;
    handleWidgetInput(clickEvt());
    expect(ClickMock).not.toHaveBeenCalled();
  });

  it("ignores events when there is no active widget", () => {
    storeState.activeWidgetId = null;
    handleWidgetInput(clickEvt());
    expect(ClickMock).not.toHaveBeenCalled();
  });

  it("ignores events with no selector candidates", () => {
    handleWidgetInput(clickEvt({ candidates: [] }));
    expect(ClickMock).not.toHaveBeenCalled();
  });

  it("ignores events when the iframe document is missing", () => {
    storeState._iframeRef = null;
    handleWidgetInput(clickEvt());
    expect(ClickMock).not.toHaveBeenCalled();
  });

  // ── click ────────────────────────────────────────────────────────────────
  it("builds a WidgetClickAction for a click on a non-text element", async () => {
    handleWidgetInput(clickEvt());

    expect(ClickMock).toHaveBeenCalledTimes(1);
    expect(ClickMock).toHaveBeenCalledWith("w1", ["#btn"], "Save", 1);
    const action = ClickMock.mock.instances[0] as Record<string, any>;
    expect(action.recordFromUserClick).toHaveBeenCalledWith(expect.anything(), {
      matchedSelector: "#btn",
      matchedIndex: 0,
    });
    expect(eventBus.setActive).toHaveBeenCalledWith(action);

    await flush();
    expect(recorder.record).toHaveBeenCalledWith(action, {
      stateChange: { widgets: {} },
    });
    expect(action.markRecorded).toHaveBeenCalled();
    expect(eventBus.setActive).toHaveBeenLastCalledWith(null);
  });

  it("ignores a click on a text-like element (routed to text input instead)", () => {
    handleWidgetInput(clickEvt({ isTextLike: true }));
    expect(ClickMock).not.toHaveBeenCalled();
  });

  it("closes any open click/text windows before starting a new click", () => {
    const openClick = { close: vi.fn() };
    const openText = { close: vi.fn(), data: { candidates: ["x"] } };
    storeState.openClick = openClick;
    storeState.openTextInput = openText;
    handleWidgetInput(clickEvt());
    expect(openClick.close).toHaveBeenCalled();
    expect(openText.close).toHaveBeenCalled();
  });

  it("finalizes a pending click before starting a text input (interaction order)", () => {
    // Repro of the Excalidraw click-"Edit"-then-type bug: typing must close
    // the open click so it records first, not last.
    const openClick = { close: vi.fn() };
    storeState.openClick = openClick;
    handleWidgetInput(keyEvt("H", { value: "H" }));
    expect(openClick.close).toHaveBeenCalled();
    expect(TextMock).toHaveBeenCalledTimes(1);
  });

  // ── text input ─────────────────────────────────────────────────────────
  it("builds a WidgetTextInputAction for an editing keyup on a text field", () => {
    handleWidgetInput(keyEvt("a", { value: "a" }));
    expect(TextMock).toHaveBeenCalledTimes(1);
    expect(TextMock).toHaveBeenCalledWith("w1", ['input[name="q"]'], "a");
    const action = TextMock.mock.instances[0] as Record<string, any>;
    expect(action.recordFromUserInput).toHaveBeenCalledWith(expect.anything(), {
      matchedSelector: 'input[name="q"]',
      matchedIndex: 0,
      initialValue: "a",
    });
  });

  it("coalesces successive keystrokes on the same field via updateValue", () => {
    const openText = {
      data: { candidates: ['input[name="q"]'] },
      updateValue: vi.fn(),
      close: vi.fn(),
    };
    storeState.openTextInput = openText;
    handleWidgetInput(keyEvt("b", { value: "ab" }));
    expect(openText.updateValue).toHaveBeenCalledWith("ab");
    expect(TextMock).not.toHaveBeenCalled();
  });

  it("closes the prior text window and opens a new one for a different field", () => {
    const openText = {
      data: { candidates: ['input[name="other"]'] },
      updateValue: vi.fn(),
      close: vi.fn(),
    };
    storeState.openTextInput = openText;
    handleWidgetInput(keyEvt("a", { value: "a" }));
    expect(openText.close).toHaveBeenCalled();
    expect(openText.updateValue).not.toHaveBeenCalled();
    expect(TextMock).toHaveBeenCalledTimes(1);
  });

  it("ignores non-editing keys (e.g. Shift, ArrowLeft)", () => {
    handleWidgetInput(keyEvt("Shift"));
    handleWidgetInput(keyEvt("ArrowLeft"));
    expect(TextMock).not.toHaveBeenCalled();
  });

  it("ignores keyup on a non-text element", () => {
    handleWidgetInput(keyEvt("a", { isTextLike: false }));
    expect(TextMock).not.toHaveBeenCalled();
  });

  // ── canvas click ─────────────────────────────────────────────────────────
  it("builds a WidgetCanvasClickAction for a canvas_click", async () => {
    handleWidgetInput(canvasEvt());

    expect(CanvasMock).toHaveBeenCalledTimes(1);
    expect(CanvasMock).toHaveBeenCalledWith(
      "w1",
      { selector: "canvas.board", index: 0, total: 1 },
      0.5,
      0.25,
      1,
    );
    const action = CanvasMock.mock.instances[0] as Record<string, any>;
    expect(action.recordFromUserClick).toHaveBeenCalled();
    expect(eventBus.setActive).toHaveBeenCalledWith(action);

    await flush();
    expect(recorder.record).toHaveBeenCalledWith(action, {
      stateChange: { widgets: {} },
    });
    expect(action.markRecorded).toHaveBeenCalled();
    expect(ClickMock).not.toHaveBeenCalled();
  });

  it("closes open windows before starting a canvas click", () => {
    const openClick = { close: vi.fn() };
    const openText = { close: vi.fn(), data: { candidates: ["x"] } };
    storeState.openClick = openClick;
    storeState.openTextInput = openText;
    handleWidgetInput(canvasEvt());
    expect(openClick.close).toHaveBeenCalled();
    expect(openText.close).toHaveBeenCalled();
  });

  it("ignores a canvas_click with no canvas locator", () => {
    handleWidgetInput(canvasEvt({ canvas: undefined }));
    expect(CanvasMock).not.toHaveBeenCalled();
  });

  it("gates canvas_click on capturing + active widget", () => {
    recorderState.capturing = false;
    handleWidgetInput(canvasEvt());
    expect(CanvasMock).not.toHaveBeenCalled();
  });

  // ── multi-click folding (detail) ─────────────────────────────────────────
  it("folds a detail:2 canvas_click into the open canvas action", () => {
    const open = new (CanvasMock as unknown as new (...a: unknown[]) => any)(
      "w1",
      { selector: "canvas.board", index: 0, total: 1 },
      0.5,
      0.25,
      1,
    );
    storeState.openClick = open;
    CanvasMock.mockClear();

    handleWidgetInput(canvasEvt({ detail: 2 }));

    expect(open.setDetail).toHaveBeenCalledWith(2);
    expect(CanvasMock).not.toHaveBeenCalled(); // no second action created
  });

  it("does NOT fold a detail:2 click onto a different canvas", () => {
    const open = new (CanvasMock as unknown as new (...a: unknown[]) => any)(
      "w1",
      { selector: "canvas.other", index: 1, total: 2 },
      0.5,
      0.25,
      1,
    );
    storeState.openClick = open;
    CanvasMock.mockClear();

    handleWidgetInput(canvasEvt({ detail: 2 })); // selector "canvas.board"

    expect(open.setDetail).not.toHaveBeenCalled();
    expect(CanvasMock).toHaveBeenCalledTimes(1); // new action instead
  });

  it("folds a detail:2 click into the open DOM click action", () => {
    const open = new (ClickMock as unknown as new (...a: unknown[]) => any)(
      "w1",
      ["#btn"],
      "Save",
      1,
    );
    storeState.openClick = open;
    ClickMock.mockClear();

    handleWidgetInput({ ...clickEvt({ candidates: ["#btn"] }), detail: 2 });

    expect(open.setDetail).toHaveBeenCalledWith(2);
    expect(ClickMock).not.toHaveBeenCalled();
  });
});
