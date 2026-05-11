import { describe, expect, it } from "vitest";
import { diff } from "./differ";
import {
  studioAction,
  emptyState,
  makeState,
  makeTrace,
} from "./__tests__/fixtures";
import type { State, Trace } from "./types";

function trace(states: State[]): Trace {
  return makeTrace({
    steps: states.map((stateAfter) => ({
      action: studioAction("set_args", { value: {} }),
      stateAfter,
    })),
  });
}

describe("diff", () => {
  it("identical_traces_produce_ok_verdict", () => {
    const t = trace([emptyState()]);
    expect(diff(t, t, []).ok).toBe(true);
  });

  it("empty_traces_produce_ok_verdict", () => {
    expect(diff(trace([]), trace([]), []).ok).toBe(true);
  });

  it("identity_short_circuit_skips_walk", () => {
    const shared = emptyState();
    expect(diff(trace([shared]), trace([shared]), []).drifts).toEqual([]);
  });

  it("value_drift_names_dot_path", () => {
    const verdict = diff(
      trace([makeState({ tools: { weather: { callCount: 1 } } })]),
      trace([makeState({ tools: { weather: { callCount: 0 } } })]),
      [],
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.drifts[0]).toMatchObject({
      path: "tools.weather.callCount",
      expected: 1,
      actual: 0,
      reason: "value_differs",
    });
  });

  it("nested_object_drift_uses_dot_path", () => {
    const verdict = diff(
      trace([
        makeState({
          tools: { weather: { callCount: 1, lastResult: { temp: 22 } } },
        }),
      ]),
      trace([
        makeState({
          tools: { weather: { callCount: 1, lastResult: { temp: 19 } } },
        }),
      ]),
      [],
    );
    expect(verdict.drifts[0].path).toBe("tools.weather.lastResult.temp");
  });

  it("array_element_drift_uses_indexed_path", () => {
    const a = makeState({
      widgets: {
        renderCount: 1,
        open: [
          { uri: "ui://a", data: { id: "x" }, mounted: true, hasErrors: false },
        ],
      },
    });
    const b = makeState({
      widgets: {
        renderCount: 1,
        open: [
          { uri: "ui://a", data: { id: "y" }, mounted: true, hasErrors: false },
        ],
      },
    });
    expect(diff(trace([a]), trace([b]), []).drifts[0].path).toBe(
      "widgets.open[0].data.id",
    );
  });

  it("missing_key_produces_missing_drift", () => {
    const verdict = diff(
      trace([makeState({ tools: { weather: { callCount: 1 } } })]),
      trace([makeState({ tools: {} })]),
      [],
    );
    expect(verdict.drifts[0]).toMatchObject({
      path: "tools.weather",
      reason: "missing",
    });
  });

  it("extra_key_produces_extra_drift", () => {
    const verdict = diff(
      trace([makeState({ tools: {} })]),
      trace([makeState({ tools: { weather: { callCount: 1 } } })]),
      [],
    );
    expect(verdict.drifts[0]).toMatchObject({
      path: "tools.weather",
      reason: "extra",
    });
  });

  it("type_difference_produces_type_differs_drift", () => {
    const exp = makeState({
      tools: { weather: { callCount: 1, lastResult: { temp: 22 } } },
    });
    const act = makeState({
      tools: {
        weather: {
          callCount: 1,
          lastResult: "not an object" as unknown as Record<string, unknown>,
        },
      },
    });
    expect(diff(trace([exp]), trace([act]), []).drifts[0].reason).toBe(
      "type_differs",
    );
  });

  it("recorded_longer_produces_step_missing", () => {
    const verdict = diff(
      trace([emptyState(), emptyState()]),
      trace([emptyState()]),
      [],
    );
    expect(verdict.drifts[0]).toMatchObject({
      stepIndex: 1,
      reason: "step_missing",
    });
  });

  it("replayed_longer_produces_step_extra", () => {
    const verdict = diff(
      trace([emptyState()]),
      trace([emptyState(), emptyState()]),
      [],
    );
    expect(verdict.drifts[0]).toMatchObject({
      stepIndex: 1,
      reason: "step_extra",
    });
  });

  it("volatile_path_suppresses_drift", () => {
    const exp = makeState({
      tools: { weather: { callCount: 1, lastResult: { id: "abc", temp: 22 } } },
    });
    const act = makeState({
      tools: { weather: { callCount: 1, lastResult: { id: "xyz", temp: 22 } } },
    });
    expect(diff(trace([exp]), trace([act]), ["tools.*.lastResult.id"]).ok).toBe(
      true,
    );
  });

  it("volatile_path_does_not_suppress_sibling_drift", () => {
    const exp = makeState({
      tools: { weather: { callCount: 1, lastResult: { id: "a", temp: 22 } } },
    });
    const act = makeState({
      tools: { weather: { callCount: 1, lastResult: { id: "b", temp: 99 } } },
    });
    const verdict = diff(trace([exp]), trace([act]), ["tools.*.lastResult.id"]);
    expect(verdict.drifts.map((x) => x.path)).toEqual([
      "tools.weather.lastResult.temp",
    ]);
  });

  it("does_not_re_report_drift_on_later_steps_when_value_unchanged", () => {
    // A cell drifts at step 0 (recorded set lastResult to {temp:5},
    // replayed set lastResult to {temp:17}). Steps 1 and 2 don't touch
    // tools.weather.lastResult — so the diff should NOT re-report the
    // same drift at those later steps.
    const driftAt0 = (temp: number) =>
      makeState({
        tools: { weather: { callCount: 1, lastResult: { temp } } },
      });
    const recorded = trace([driftAt0(5), driftAt0(5), driftAt0(5)]);
    const replayed = trace([driftAt0(17), driftAt0(17), driftAt0(17)]);
    const verdict = diff(recorded, replayed, []);
    // Exactly one drift at step 0 — not three.
    expect(verdict.drifts.map((x) => [x.stepIndex, x.path])).toEqual([
      [0, "tools.weather.lastResult.temp"],
    ]);
  });

  it("reports drift at the step where the value changes again", () => {
    // Step 0: both sides set lastResult, values differ.
    // Step 1: cell unchanged on both sides — suppressed.
    // Step 2: both sides set a new lastResult; values differ again.
    const recorded = trace([
      makeState({ tools: { w: { callCount: 1, lastResult: { temp: 5 } } } }),
      makeState({ tools: { w: { callCount: 1, lastResult: { temp: 5 } } } }),
      makeState({ tools: { w: { callCount: 2, lastResult: { temp: 8 } } } }),
    ]);
    const replayed = trace([
      makeState({ tools: { w: { callCount: 1, lastResult: { temp: 17 } } } }),
      makeState({ tools: { w: { callCount: 1, lastResult: { temp: 17 } } } }),
      makeState({ tools: { w: { callCount: 2, lastResult: { temp: 23 } } } }),
    ]);
    const verdict = diff(recorded, replayed, []);
    expect(verdict.drifts.map((x) => [x.stepIndex, x.path])).toEqual([
      [0, "tools.w.lastResult.temp"],
      [2, "tools.w.lastResult.temp"],
    ]);
  });

  it("drifts_sorted_by_step_then_path", () => {
    const verdict = diff(
      trace([
        makeState({ tools: { a: { callCount: 1 } } }),
        makeState({ tools: { b: { callCount: 1 } } }),
      ]),
      trace([
        makeState({ tools: { a: { callCount: 9 } } }),
        makeState({ tools: { b: { callCount: 9 } } }),
      ]),
      [],
    );
    expect(verdict.drifts.map((x) => [x.stepIndex, x.path])).toEqual([
      [0, "tools.a.callCount"],
      [1, "tools.b.callCount"],
    ]);
  });
});
