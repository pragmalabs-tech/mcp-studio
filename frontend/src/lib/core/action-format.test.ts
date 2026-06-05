// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { actionLabel, actionSummary, clickVerb } from "./action-format";

describe("clickVerb", () => {
  it("maps detail to a verb", () => {
    expect(clickVerb(1)).toBe("Click");
    expect(clickVerb(2)).toBe("Double-click");
    expect(clickVerb(3)).toBe("Triple-click");
    expect(clickVerb(5)).toBe("Click ×5");
  });

  it("defaults missing/invalid detail to single", () => {
    expect(clickVerb(undefined)).toBe("Click");
    expect(clickVerb(0)).toBe("Click");
  });
});

describe("actionLabel", () => {
  it("labels a single widget click with its target", () => {
    expect(
      actionLabel({
        type: "WIDGET_CLICK",
        data: { fallbackText: "Edit", detail: 1 },
      }),
    ).toBe("Click · Edit");
  });

  it("labels a double widget click", () => {
    expect(
      actionLabel({
        type: "WIDGET_CLICK",
        data: { fallbackText: "Edit", detail: 2 },
      }),
    ).toBe("Double-click · Edit");
  });

  it("labels a canvas click with detail and position", () => {
    expect(
      actionLabel({
        type: "WIDGET_CANVAS_CLICK",
        data: { nx: 0.674, ny: 0.4, detail: 2 },
      }),
    ).toBe("Canvas double-click · 67%×40%");
  });

  it("labels tool / resource / text-input actions", () => {
    expect(actionLabel({ type: "TOOL_CALL", data: { tool: "search" } })).toBe(
      "Tool · search",
    );
    expect(
      actionLabel({ type: "RESOURCE_READ", data: { uri: "ui://x" } }),
    ).toBe("Resource · ui://x");
    expect(
      actionLabel({ type: "WIDGET_TEXT_INPUT", data: { value: "Hien" } }),
    ).toBe("Type · Hien");
  });

  it("falls back to the raw type for unknowns and null", () => {
    expect(actionLabel({ type: "MYSTERY", data: {} })).toBe("MYSTERY");
    expect(actionLabel(null)).toBe("Action");
  });
});

describe("actionSummary", () => {
  it("summarizes tool params and ignores others", () => {
    expect(
      actionSummary({ type: "TOOL_CALL", data: { params: { q: "hi" } } }),
    ).toBe('{"q":"hi"}');
    expect(actionSummary({ type: "WIDGET_CLICK", data: {} })).toBe("");
  });
});
