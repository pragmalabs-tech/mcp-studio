import { describe, expect, it } from "vitest";
import { diff } from "./differ";
import { emptyResolvedRules } from "./rules";
import {
  studioAction,
  mcpAction,
  widgetAction,
  emptyState,
  makeState,
  makeTrace,
} from "./__tests__/fixtures";
import type { Action, ResolvedRules, State, Trace } from "./types";

function trace(states: State[]): Trace {
  return makeTrace({
    steps: states.map((stateAfter) => ({
      action: studioAction("set_args", { value: {} }),
      stateAfter,
    })),
  });
}

function traceOf(steps: Array<{ action: Action; stateAfter: State }>): Trace {
  return makeTrace({ steps });
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
      // studio "set_args" is user-source — engine bug if it's missing,
      // so this stays a hard fail.
      severity: "fail",
    });
    expect(verdict.ok).toBe(false);
  });

  it("step_missing_for_widget_source_action_is_warn_not_fail", () => {
    // A missing widget.intent is typically a timing miss (widget didn't
    // emit setWidgetState within engine's 2s budget). Demoted to warn so
    // it doesn't poison the trace as a hard fail.
    const recorded = traceOf([
      {
        action: widgetAction("intent", { name: "setWidgetState", params: {} }),
        stateAfter: emptyState(),
      },
    ]);
    const replayed = traceOf([]);
    const verdict = diff(recorded, replayed, NO_RULES);
    expect(verdict.drifts[0]).toMatchObject({
      stepIndex: 0,
      reason: "step_missing",
      severity: "warn",
    });
    // warn drifts pass — Verdict.ok stays true.
    expect(verdict.ok).toBe(true);
  });

  it("step_missing_for_server_source_action_is_warn_not_fail", () => {
    // A missing mcp.response = the server didn't reply within 2s.
    // Same timing-miss treatment as widget intents.
    const recorded = traceOf([
      {
        action: mcpAction("response", {
          requestId: 1,
          durationMs: 1,
          result: {},
        }),
        stateAfter: emptyState(),
      },
    ]);
    const replayed = traceOf([]);
    const verdict = diff(recorded, replayed, NO_RULES);
    expect(verdict.drifts[0]).toMatchObject({
      stepIndex: 0,
      reason: "step_missing",
      severity: "warn",
    });
    expect(verdict.ok).toBe(true);
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

  // ── action-kind alignment ──────────────────────────────────────────────
  // The differ aligns by (driver, kind) with a look-ahead window. A
  // missing or extra step shouldn't cascade state drifts onto every
  // subsequent step the way a strict index-pair compare would.

  it("missing_widget_intent_in_middle_does_not_cascade", () => {
    // Recorded: click, intent, click. Replayed: click, click (intent
    // timed out, never arrived). Without alignment, the differ would
    // compare recorded[1]=intent.stateAfter vs replayed[1]=click.stateAfter
    // (different states → drifts) AND mark recorded[2]=click as missing.
    // With alignment: skip the missing intent (warn), then align both
    // clicks. The drift on widgets.intents is the real state effect of
    // the missing intent (recorded has intents[0], replay doesn't) —
    // can't make that vanish without time-travel, but it surfaces ONCE
    // at the alignment boundary, not cascading per subsequent step.
    //
    // Real reducer reuses slice references for actions that don't
    // mutate them (e.g. dom.click), so click→click on the replayed side
    // keeps the widgets slice identical. Mirror that here so the
    // identity short-circuit can fire.
    const clickRecState = emptyState();
    const intentRecState = makeState({
      widgets: {
        renderCount: 0,
        open: [],
        intents: [{ name: "setWidgetState", params: {} }],
        activeRender: null,
      },
    });
    // dom.click after intent doesn't touch widgets — share the slice
    // reference exactly as the real widget driver does.
    const click2RecState: State = {
      ...intentRecState,
      // No widgets change; share the slice.
      widgets: intentRecState.widgets,
    };
    const clickRepState = emptyState();
    const click2RepState: State = {
      ...clickRepState,
      widgets: clickRepState.widgets,
    };

    const recorded = traceOf([
      {
        action: widgetAction("dom.click", { selectors: { testid: "x" } }),
        stateAfter: clickRecState,
      },
      {
        action: widgetAction("intent", { name: "setWidgetState", params: {} }),
        stateAfter: intentRecState,
      },
      {
        action: widgetAction("dom.click", { selectors: { testid: "y" } }),
        stateAfter: click2RecState,
      },
    ]);
    const replayed = traceOf([
      {
        action: widgetAction("dom.click", { selectors: { testid: "x" } }),
        stateAfter: clickRepState,
      },
      {
        action: widgetAction("dom.click", { selectors: { testid: "y" } }),
        stateAfter: click2RepState,
      },
    ]);

    const verdict = diff(recorded, replayed, NO_RULES);
    // Alignment: rec[0]↔rep[0] (clean), rec[1]=missing intent (warn),
    // rec[2]↔rep[1] (clean). The dom.click doesn't move widgets, and
    // the differ's identity short-circuit recognises that neither
    // side's widgets slice changed since the previous compared step —
    // so no per-cell drifts on widgets.* even though the recorded side
    // carries the intent's effect. Only the step_missing drift remains.
    expect(verdict.drifts).toHaveLength(1);
    expect(verdict.drifts[0]).toMatchObject({
      stepIndex: 1,
      reason: "step_missing",
      severity: "warn",
    });
    // Only warn drifts → verdict ok.
    expect(verdict.ok).toBe(true);
  });

  it("extra_widget_intent_in_replay_does_not_cascade", () => {
    // Recorded: click, click. Replayed: click, intent (unexpected),
    // click. With alignment: the extra intent is flagged once; both
    // click pairs align cleanly.
    const recorded = traceOf([
      {
        action: widgetAction("dom.click", { selectors: { testid: "x" } }),
        stateAfter: emptyState(),
      },
      {
        action: widgetAction("dom.click", { selectors: { testid: "y" } }),
        stateAfter: emptyState(),
      },
    ]);
    const replayed = traceOf([
      {
        action: widgetAction("dom.click", { selectors: { testid: "x" } }),
        stateAfter: emptyState(),
      },
      {
        action: widgetAction("intent", { name: "setWidgetState", params: {} }),
        stateAfter: emptyState(),
      },
      {
        action: widgetAction("dom.click", { selectors: { testid: "y" } }),
        stateAfter: emptyState(),
      },
    ]);

    const verdict = diff(recorded, replayed, NO_RULES);
    expect(verdict.drifts).toHaveLength(1);
    expect(verdict.drifts[0]).toMatchObject({ reason: "step_extra" });
  });

  it("synthetic_replay_step_surfaces_as_warn_step_missing", () => {
    // Engine pads replay with a synthetic placeholder when a widget/
    // server action times out. The differ should treat it as a warn
    // step_missing (mirroring the alignment-skip path), not as a state
    // drift between empty placeholder state and real recorded state.
    const recorded = traceOf([
      {
        action: widgetAction("intent", { name: "setWidgetState", params: {} }),
        stateAfter: makeState({
          widgets: {
            renderCount: 0,
            open: [],
            intents: [{ name: "setWidgetState", params: {} }],
            activeRender: null,
          },
        }),
      },
    ]);
    const replayed = traceOf([
      {
        action: widgetAction("intent", { name: "setWidgetState", params: {} }),
        stateAfter: emptyState(),
      },
    ]);
    // Mark the replay step as synthetic (what the engine would do).
    replayed.steps[0] = { ...replayed.steps[0], synthetic: true };

    const verdict = diff(recorded, replayed, NO_RULES);
    // Single drift: the placeholder surfaces as warn step_missing, not
    // as a per-cell state drift on widgets.intents.
    expect(verdict.drifts).toHaveLength(1);
    expect(verdict.drifts[0]).toMatchObject({
      stepIndex: 0,
      reason: "step_missing",
      severity: "warn",
    });
    expect(verdict.ok).toBe(true);
  });

  it("aligned_pair_compares_states_normally", () => {
    // Sanity: when both sides have the same action at the same index,
    // alignment is a no-op and state comparison runs as before.
    const exp = makeState({ tools: { weather: { callCount: 1 } } });
    const act = makeState({ tools: { weather: { callCount: 2 } } });
    const verdict = diff(
      traceOf([
        {
          action: widgetAction("dom.click", { selectors: { testid: "x" } }),
          stateAfter: exp,
        },
      ]),
      traceOf([
        {
          action: widgetAction("dom.click", { selectors: { testid: "x" } }),
          stateAfter: act,
        },
      ]),
      NO_RULES,
    );
    expect(verdict.drifts.some((dr) => dr.reason === "value_differs")).toBe(
      true,
    );
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
