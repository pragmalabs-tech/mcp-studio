import { describe, expect, it } from "vitest";
import { widgetDriver } from "./widget";
import { emptyState, makeState, widgetAction } from "../__tests__/fixtures";
import type { WidgetAction } from "../types";

describe("widget driver", () => {
  it("initialSlice__returns_empty_open_stack_and_intents", () => {
    expect(widgetDriver.initialSlice()).toEqual({
      renderCount: 0,
      open: [],
      intents: [],
      activeRender: null,
    });
  });

  it("apply_opened__pushes_widget_and_bumps_rendercount", () => {
    const after = widgetDriver.apply(
      emptyState(),
      widgetAction("opened", { uri: "ui://q.html", data: { q: "?" } }),
    );
    expect(after.widgets.renderCount).toBe(1);
    expect(after.widgets.open).toEqual([
      { uri: "ui://q.html", data: { q: "?" }, mounted: true, hasErrors: false },
    ]);
  });

  it("apply_opened__appends_to_existing_stack", () => {
    const before = makeState({
      widgets: {
        renderCount: 1,
        open: [
          { uri: "ui://a.html", data: {}, mounted: true, hasErrors: false },
        ],
      },
    });
    const after = widgetDriver.apply(
      before,
      widgetAction("opened", { uri: "ui://b.html", data: {} }),
    );
    expect(after.widgets.open).toHaveLength(2);
    expect(after.widgets.renderCount).toBe(2);
  });

  it("apply_runtime_error__flags_top_of_stack_and_bumps_errorcount", () => {
    const before = makeState({
      widgets: {
        renderCount: 2,
        open: [
          { uri: "ui://a", data: {}, mounted: true, hasErrors: false },
          { uri: "ui://b", data: {}, mounted: true, hasErrors: false },
        ],
      },
    });
    const after = widgetDriver.apply(
      before,
      widgetAction("runtime_error", { message: "boom" }),
    );
    expect(after.widgets.open[0].hasErrors).toBe(false);
    expect(after.widgets.open[1].hasErrors).toBe(true);
    expect(after.network.errorCount).toBe(1);
  });

  it("apply_runtime_error__still_bumps_errorcount_with_empty_stack", () => {
    const after = widgetDriver.apply(
      emptyState(),
      widgetAction("runtime_error", { message: "early" }),
    );
    expect(after.network.errorCount).toBe(1);
  });

  // Five DOM kinds, all pure pass-through. One parameterised check.
  it.each<[WidgetAction["kind"], WidgetAction["payload"]]>([
    ["dom.click", { selectors: { testid: "x" } }],
    [
      "dom.input",
      { selectors: { testid: "x" }, value: "v", inputType: "insertText" },
    ],
    ["dom.change", { selectors: { testid: "x" }, value: "v" }],
    ["dom.submit", { selectors: { testid: "x" } }],
    [
      "dom.keydown",
      { selectors: { testid: "x" }, key: "Enter", code: "Enter", mods: 0 },
    ],
  ])("apply_%s__returns_same_state_reference", (kind, payload) => {
    const before = emptyState();
    const after = widgetDriver.apply(
      before,
      widgetAction(kind, payload as never),
    );
    expect(after).toBe(before);
  });

  it("volatilePaths__declares_data_id_and_timestamps", () => {
    const paths = widgetDriver.volatilePaths();
    expect(paths).toContain("open[*].data.id");
    expect(paths).toContain("open[*].data.created_at");
  });

  it("apply_intent__appends_to_intents_log", () => {
    const after = widgetDriver.apply(
      emptyState(),
      widgetAction("intent", {
        name: "ui/message",
        params: { text: "Continue Learning" },
      }),
    );
    expect(after.widgets.intents).toEqual([
      { name: "ui/message", params: { text: "Continue Learning" } },
    ]);
    expect(after.widgets.renderCount).toBe(0);
    expect(after.widgets.open).toEqual([]);
  });

  it("apply_intent__preserves_order_across_multiple_intents", () => {
    const a = widgetDriver.apply(
      emptyState(),
      widgetAction("intent", { name: "ui/message", params: { text: "a" } }),
    );
    const b = widgetDriver.apply(
      a,
      widgetAction("intent", {
        name: "sendFollowUpMessage",
        params: { text: "b" },
      }),
    );
    expect(b.widgets.intents.map((i) => i.name)).toEqual([
      "ui/message",
      "sendFollowUpMessage",
    ]);
  });

  it("volatilePaths__declares_callId_as_volatile", () => {
    expect(widgetDriver.volatilePaths()).toContain("intents[*].params.callId");
  });

  it("apply_render__captures_widgetName_and_mock_in_activeRender", () => {
    const after = widgetDriver.apply(
      emptyState(),
      widgetAction("render", {
        widgetName: "goal_detail",
        mock: {
          toolInput: { course_id: "c1" },
          toolOutput: { lessons: [] },
          meta: { "openai/widgetAccessible": true },
          widgetState: null,
        },
      }),
    );
    expect(after.widgets.activeRender).toEqual({
      widgetName: "goal_detail",
      mock: {
        toolInput: { course_id: "c1" },
        toolOutput: { lessons: [] },
        meta: { "openai/widgetAccessible": true },
        widgetState: null,
      },
    });
  });

  it("apply_render__overwrites_previous_activeRender", () => {
    const a = widgetDriver.apply(
      emptyState(),
      widgetAction("render", {
        widgetName: "first",
        mock: {
          toolInput: {},
          toolOutput: { v: 1 },
          meta: {},
          widgetState: null,
        },
      }),
    );
    const b = widgetDriver.apply(
      a,
      widgetAction("render", {
        widgetName: "second",
        mock: {
          toolInput: {},
          toolOutput: { v: 2 },
          meta: {},
          widgetState: null,
        },
      }),
    );
    expect(b.widgets.activeRender?.widgetName).toBe("second");
    expect(b.widgets.activeRender?.mock.toolOutput).toEqual({ v: 2 });
  });
});
