import { describe, expect, it } from "vitest";
import { applyAction, fold, foldTrace } from "./fold";
import {
  studioAction,
  emptyState,
  makeTrace,
  mcpAction,
  widgetAction,
} from "./__tests__/fixtures";
import type { Action } from "./types";

describe("fold", () => {
  it("fold__empty_actions_returns_empty_array", () => {
    expect(fold(emptyState(), [])).toEqual([]);
  });

  it("fold__multi_driver_sequence_routes_via_registry", () => {
    const actions: Action[] = [
      studioAction("select", { selection: { type: "tool", name: "weather" } }),
      mcpAction("request", {
        id: 1,
        method: "tools/call",
        params: { name: "weather", arguments: {} },
      }),
      mcpAction("response", {
        requestId: 1,
        tool: "weather",
        durationMs: 5,
        result: { uri: "ui://w.html" },
      }),
      widgetAction("opened", { uri: "ui://w.html", data: { temp: 22 } }),
    ];
    const states = fold(emptyState(), actions);
    expect(states[0].studio.selected?.name).toBe("weather");
    expect(states[1].tools.weather.callCount).toBe(1);
    expect(states[2].tools.weather.lastResult).toEqual({ uri: "ui://w.html" });
    expect(states[3].widgets.renderCount).toBe(1);
  });

  it("fold__pure_passthrough_action_emits_same_state_reference", () => {
    const opened = fold(emptyState(), [
      widgetAction("opened", { uri: "ui://x.html", data: {} }),
    ]);
    const click = widgetAction("dom.click", { selectors: { testid: "btn" } });
    expect(applyAction(opened[0], click)).toBe(opened[0]);
  });

  it("applyAction__throws_for_unknown_driver", () => {
    const bogus = {
      driver: "ghost",
      kind: "noop",
      source: "user",
      payload: {},
    };
    expect(() => applyAction(emptyState(), bogus as never)).toThrow(
      /no driver/,
    );
  });

  it("foldTrace__fills_stateafter_on_every_step", () => {
    const trace = makeTrace({
      steps: [
        {
          action: mcpAction("request", {
            id: 1,
            method: "tools/call",
            params: { name: "weather", arguments: {} },
          }),
          stateAfter: emptyState(),
        },
        {
          action: mcpAction("response", {
            requestId: 1,
            tool: "weather",
            durationMs: 5,
            result: { temp: 22 },
          }),
          stateAfter: emptyState(),
        },
      ],
    });
    const folded = foldTrace(trace);
    expect(folded.steps[0].stateAfter.tools.weather.callCount).toBe(1);
    expect(folded.steps[1].stateAfter.tools.weather.lastResult).toEqual({
      temp: 22,
    });
  });

  it("foldTrace__is_idempotent", () => {
    const trace = makeTrace({
      steps: [
        {
          action: studioAction("set_config", { patch: { theme: "light" } }),
          stateAfter: emptyState(),
        },
      ],
    });
    const once = foldTrace(trace);
    const twice = foldTrace(once);
    expect(twice.steps[0].stateAfter).toEqual(once.steps[0].stateAfter);
  });

  it("foldTrace__preserves_extra_step_fields_like_compare_mode", () => {
    const trace = makeTrace({
      steps: [
        {
          action: mcpAction("response", {
            requestId: 1,
            tool: "weather",
            durationMs: 5,
            result: { temp: 22 },
          }),
          stateAfter: emptyState(),
        },
      ],
    });
    trace.steps[0] = { ...trace.steps[0], compare: "shape" };
    const folded = foldTrace(trace);
    expect(folded.steps[0].compare).toBe("shape");
  });
});
