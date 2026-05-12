import { describe, expect, it } from "vitest";
import { diff } from "./differ";
import { emptyResolvedRules } from "./rules";
import {
  studioAction,
  emptyState,
  makeState,
  makeTrace,
} from "./__tests__/fixtures";
import type { ResolvedRules, State, Trace } from "./types";

function trace(states: State[]): Trace {
  return makeTrace({
    steps: states.map((stateAfter) => ({
      action: studioAction("set_args", { value: {} }),
      stateAfter,
    })),
  });
}

const NO_RULES: ResolvedRules = emptyResolvedRules();

function ignoreOnly(...patterns: string[]): ResolvedRules {
  return {
    ignore: patterns.map(
      (pattern) => ({ pattern, layer: "trace.ignore" }) as const,
    ),
    match: [],
  };
}

describe("diff", () => {
  it("identical_traces_produce_ok_verdict", () => {
    const t = trace([emptyState()]);
    expect(diff(t, t, NO_RULES).ok).toBe(true);
  });

  it("empty_traces_produce_ok_verdict", () => {
    expect(diff(trace([]), trace([]), NO_RULES).ok).toBe(true);
  });

  it("identity_short_circuit_skips_walk", () => {
    const shared = emptyState();
    expect(diff(trace([shared]), trace([shared]), NO_RULES).drifts).toEqual([]);
  });

  it("value_drift_names_dot_path", () => {
    const verdict = diff(
      trace([makeState({ tools: { weather: { callCount: 1 } } })]),
      trace([makeState({ tools: { weather: { callCount: 0 } } })]),
      NO_RULES,
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
      NO_RULES,
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
    expect(diff(trace([a]), trace([b]), NO_RULES).drifts[0].path).toBe(
      "widgets.open[0].data.id",
    );
  });

  it("missing_key_produces_missing_drift", () => {
    const verdict = diff(
      trace([makeState({ tools: { weather: { callCount: 1 } } })]),
      trace([makeState({ tools: {} })]),
      NO_RULES,
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
      NO_RULES,
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
    expect(diff(trace([exp]), trace([act]), NO_RULES).drifts[0].reason).toBe(
      "type_differs",
    );
  });

  it("recorded_longer_produces_step_missing", () => {
    const verdict = diff(
      trace([emptyState(), emptyState()]),
      trace([emptyState()]),
      NO_RULES,
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
      NO_RULES,
    );
    expect(verdict.drifts[0]).toMatchObject({
      stepIndex: 1,
      reason: "step_extra",
    });
  });

  it("ignore_pattern_suppresses_drift_but_keeps_it_in_list", () => {
    const exp = makeState({
      tools: { weather: { callCount: 1, lastResult: { id: "abc", temp: 22 } } },
    });
    const act = makeState({
      tools: { weather: { callCount: 1, lastResult: { id: "xyz", temp: 22 } } },
    });
    const verdict = diff(
      trace([exp]),
      trace([act]),
      ignoreOnly("tools.*.lastResult.id"),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.drifts).toHaveLength(1);
    expect(verdict.drifts[0].suppressedBy).toEqual({
      layer: "trace.ignore",
      pattern: "tools.*.lastResult.id",
    });
  });

  it("ignore_does_not_suppress_sibling_drift", () => {
    const exp = makeState({
      tools: { weather: { callCount: 1, lastResult: { id: "a", temp: 22 } } },
    });
    const act = makeState({
      tools: { weather: { callCount: 1, lastResult: { id: "b", temp: 99 } } },
    });
    const verdict = diff(
      trace([exp]),
      trace([act]),
      ignoreOnly("tools.*.lastResult.id"),
    );
    const surfaced = verdict.drifts.filter((d) => !d.suppressedBy);
    expect(surfaced.map((x) => x.path)).toEqual([
      "tools.weather.lastResult.temp",
    ]);
  });

  it("match_matcher_passing_downgrades_severity_to_warn", () => {
    const exp = makeState({
      tools: {
        weather: {
          callCount: 1,
          lastResult: { ts: "2026-05-11T12:34:36Z", temp: 22 },
        },
      },
    });
    const act = makeState({
      tools: {
        weather: {
          callCount: 1,
          lastResult: { ts: "2026-05-11T12:35:09Z", temp: 22 },
        },
      },
    });
    const rules: ResolvedRules = {
      ignore: [],
      match: [
        {
          pattern: "tools.*.lastResult.ts",
          matcher: "@iso8601",
          layer: "trace.match",
        },
      ],
    };
    const verdict = diff(trace([exp]), trace([act]), rules);
    expect(verdict.ok).toBe(true);
    expect(verdict.drifts).toHaveLength(1);
    expect(verdict.drifts[0].severity).toBe("warn");
    expect(verdict.drifts[0].suppressedBy?.layer).toBe("trace.match");
  });

  it("classifier_attaches_classification_to_unsuppressed_iso_drift", () => {
    const exp = makeState({
      tools: {
        weather: {
          callCount: 1,
          lastResult: { ts: "2026-05-11T12:34:36Z" },
        },
      },
    });
    const act = makeState({
      tools: {
        weather: {
          callCount: 1,
          lastResult: { ts: "2026-05-11T12:35:09Z" },
        },
      },
    });
    const verdict = diff(trace([exp]), trace([act]), NO_RULES);
    expect(verdict.drifts[0].severity).toBe("fail");
    expect(verdict.drifts[0].classification?.kind).toBe("iso8601");
    expect(verdict.drifts[0].classification?.suggested).toEqual({
      match: "@iso8601",
    });
  });

  it("classifier_does_not_run_on_ignored_drift", () => {
    const exp = makeState({
      tools: {
        weather: { callCount: 1, lastResult: { ts: "2026-05-11T12:34:36Z" } },
      },
    });
    const act = makeState({
      tools: {
        weather: { callCount: 1, lastResult: { ts: "2026-05-11T12:35:09Z" } },
      },
    });
    const verdict = diff(
      trace([exp]),
      trace([act]),
      ignoreOnly("tools.*.lastResult.ts"),
    );
    expect(verdict.drifts[0].classification).toBeUndefined();
    expect(verdict.drifts[0].suppressedBy?.layer).toBe("trace.ignore");
  });

  it("match_matcher_failing_surfaces_drift", () => {
    const exp = makeState({
      tools: {
        weather: { callCount: 1, lastResult: { ts: "not-a-datetime" } },
      },
    });
    const act = makeState({
      tools: {
        weather: { callCount: 1, lastResult: { ts: "also-not-a-datetime" } },
      },
    });
    const rules: ResolvedRules = {
      ignore: [],
      match: [
        {
          pattern: "tools.*.lastResult.ts",
          matcher: "@iso8601",
          layer: "trace.match",
        },
      ],
    };
    const verdict = diff(trace([exp]), trace([act]), rules);
    expect(verdict.ok).toBe(false);
    expect(verdict.drifts[0].suppressedBy).toBeUndefined();
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
    const verdict = diff(recorded, replayed, NO_RULES);
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
    const verdict = diff(recorded, replayed, NO_RULES);
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
      NO_RULES,
    );
    expect(verdict.drifts.map((x) => [x.stepIndex, x.path])).toEqual([
      [0, "tools.a.callCount"],
      [1, "tools.b.callCount"],
    ]);
  });
});

describe("diff shape mode", () => {
  function shapeTrace(states: State[]): Trace {
    const t = trace(states);
    return {
      ...t,
      steps: t.steps.map((s) => ({ ...s, compare: "shape" as const })),
    };
  }

  it("suppresses leaf value differences", () => {
    const exp = makeState({
      tools: { w: { callCount: 1, lastResult: { id: "a", n: 1 } } },
    });
    const act = makeState({
      tools: { w: { callCount: 1, lastResult: { id: "b", n: 2 } } },
    });
    const verdict = diff(shapeTrace([exp]), trace([act]), NO_RULES);
    expect(verdict.ok).toBe(true);
    expect(verdict.drifts).toEqual([]);
  });

  it("suppresses array length differences", () => {
    const exp = makeState({
      tools: {
        w: {
          callCount: 1,
          lastResult: { items: [{ id: "a" }] },
        },
      },
    });
    const act = makeState({
      tools: {
        w: {
          callCount: 1,
          lastResult: { items: [{ id: "x" }, { id: "y" }, { id: "z" }] },
        },
      },
    });
    const verdict = diff(shapeTrace([exp]), trace([act]), NO_RULES);
    expect(verdict.ok).toBe(true);
    expect(verdict.drifts).toEqual([]);
  });

  it("still emits type_differs when JSON type changes", () => {
    const exp = makeState({
      tools: { w: { callCount: 1, lastResult: { temp: 22 } } },
    });
    const act = makeState({
      tools: {
        w: {
          callCount: 1,
          lastResult: { temp: "warm" as unknown as number },
        },
      },
    });
    const verdict = diff(shapeTrace([exp]), trace([act]), NO_RULES);
    expect(verdict.ok).toBe(false);
    expect(verdict.drifts[0]).toMatchObject({
      path: "tools.w.lastResult.temp",
      reason: "type_differs",
    });
  });

  it("still emits missing for dropped object keys", () => {
    const exp = makeState({
      tools: { w: { callCount: 1, lastResult: { id: "a", temp: 22 } } },
    });
    const act = makeState({
      tools: { w: { callCount: 1, lastResult: { id: "a" } } },
    });
    const verdict = diff(shapeTrace([exp]), trace([act]), NO_RULES);
    expect(verdict.ok).toBe(false);
    expect(verdict.drifts[0]).toMatchObject({
      path: "tools.w.lastResult.temp",
      reason: "missing",
    });
  });

  it("suppresses extra object keys (forward-compatible)", () => {
    const exp = makeState({
      tools: { w: { callCount: 1, lastResult: { id: "a" } } },
    });
    const act = makeState({
      tools: {
        w: { callCount: 1, lastResult: { id: "a", newField: "added" } },
      },
    });
    const verdict = diff(shapeTrace([exp]), trace([act]), NO_RULES);
    expect(verdict.ok).toBe(true);
    expect(verdict.drifts).toEqual([]);
  });

  it("widget render: wrong widgetName produces value_differs drift", () => {
    const exp = makeState({
      widgets: {
        activeRender: {
          widgetName: "goal_detail",
          mock: {
            toolInput: {},
            toolOutput: {},
            meta: {},
            widgetState: null,
          },
        },
      },
    });
    const act = makeState({
      widgets: {
        activeRender: {
          widgetName: "wrong_widget",
          mock: {
            toolInput: {},
            toolOutput: {},
            meta: {},
            widgetState: null,
          },
        },
      },
    });
    const verdict = diff(trace([exp]), trace([act]), NO_RULES);
    expect(verdict.ok).toBe(false);
    expect(verdict.drifts[0]).toMatchObject({
      path: "widgets.activeRender.widgetName",
      reason: "value_differs",
    });
  });

  it("widget render: shape mode on the step suppresses mock value drifts", () => {
    const exp = makeState({
      widgets: {
        activeRender: {
          widgetName: "goal_detail",
          mock: {
            toolInput: {},
            toolOutput: { id: "uuid-A" },
            meta: {},
            widgetState: null,
          },
        },
      },
    });
    const act = makeState({
      widgets: {
        activeRender: {
          widgetName: "goal_detail",
          mock: {
            toolInput: {},
            toolOutput: { id: "uuid-B" },
            meta: {},
            widgetState: null,
          },
        },
      },
    });
    const recorded = trace([exp]);
    recorded.steps[0] = { ...recorded.steps[0], compare: "shape" };
    const verdict = diff(recorded, trace([act]), NO_RULES);
    expect(verdict.ok).toBe(true);
    expect(verdict.drifts).toEqual([]);
  });

  it("widget intent: extra intent on replay surfaces as drift", () => {
    const exp = makeState({
      widgets: { intents: [{ name: "ui/message", params: { text: "a" } }] },
    });
    const act = makeState({
      widgets: {
        intents: [
          { name: "ui/message", params: { text: "a" } },
          { name: "ui/open-link", params: { url: "https://x" } },
        ],
      },
    });
    const verdict = diff(trace([exp]), trace([act]), NO_RULES);
    expect(verdict.ok).toBe(false);
    const surfaced = verdict.drifts.filter((d) => !d.suppressedBy);
    expect(surfaced.map((d) => d.path)).toContain("widgets.intents[1]");
  });

  it("widget intent: name change surfaces as value_differs", () => {
    const exp = makeState({
      widgets: { intents: [{ name: "ui/message", params: {} }] },
    });
    const act = makeState({
      widgets: { intents: [{ name: "sendFollowUpMessage", params: {} }] },
    });
    const verdict = diff(trace([exp]), trace([act]), NO_RULES);
    expect(verdict.ok).toBe(false);
    expect(verdict.drifts[0]).toMatchObject({
      path: "widgets.intents[0].name",
      reason: "value_differs",
    });
  });

  it("only the step with compare:shape switches mode", () => {
    // Step 0 is shape-only, step 1 is exact. Both have value drifts.
    // Step 1 uses fresh primitive values so the identity short-circuit
    // doesn't suppress its drift.
    const recorded = trace([
      makeState({ tools: { w: { callCount: 1, lastResult: { v: 1 } } } }),
      makeState({ tools: { w: { callCount: 2, lastResult: { v: 2 } } } }),
    ]);
    recorded.steps[0] = { ...recorded.steps[0], compare: "shape" };
    const replayed = trace([
      makeState({ tools: { w: { callCount: 1, lastResult: { v: 99 } } } }),
      makeState({ tools: { w: { callCount: 2, lastResult: { v: 100 } } } }),
    ]);
    const verdict = diff(recorded, replayed, NO_RULES);
    // Step 0 shape-mode: no drift. Step 1 exact-mode: lastResult.v drifts.
    const surfaced = verdict.drifts.filter((d) => !d.suppressedBy);
    expect(surfaced.map((x) => [x.stepIndex, x.path])).toEqual([
      [1, "tools.w.lastResult.v"],
    ]);
  });
});
