import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, loadTrace, saveTrace, toTrace } from "./trace-io";
import { buildInitialState } from "./registry";
import { studioAction, makeTrace } from "./__tests__/fixtures";
import type { Recorded } from "@/lib/recorder/schema";

describe("trace-io", () => {
  it("loadTrace__roundtrips_current_schema", () => {
    const t = makeTrace({
      steps: [
        {
          action: studioAction("set_args", { value: { x: 1 } }),
          stateAfter: buildInitialState(),
        },
      ],
    });
    const loaded = loadTrace(saveTrace(t));
    expect(loaded.id).toBe(t.id);
    expect(loaded.steps).toHaveLength(1);
    // foldTrace re-fills stateAfter; we verify the state is consistent.
    expect(loaded.steps[0].stateAfter.studio.editor.args).toEqual({ x: 1 });
  });

  it("loadTrace__throws_on_unknown_schema_version", () => {
    expect(() =>
      loadTrace({
        schemaVersion: 99,
        id: "x",
        name: "x",
        capturedAt: "x",
        setup: { url: "" },
        initialState: buildInitialState(),
        steps: [],
      }),
    ).toThrow(/unknown schemaVersion/);
  });

  it("loadTrace__throws_on_missing_required_fields", () => {
    expect(() =>
      loadTrace({ schemaVersion: SCHEMA_VERSION, name: "x" }),
    ).toThrow(/missing or invalid 'id'/);
  });

  it("loadTrace__migrates_legacy_test_envelope", () => {
    const legacy = {
      id: "legacy-1",
      name: "Old recording",
      createdAt: "2026-01-01T00:00:00.000Z",
      session: {
        timeline: [
          {
            kind: "sidebar.select",
            selection: { type: "tool", name: "weather" },
          },
          { kind: "editor.set_args", value: { city: "Tokyo" } },
          {
            kind: "mcp.request",
            id: 1,
            source: "user",
            method: "tools/call",
            params: { name: "weather", arguments: { city: "Tokyo" } },
          },
          {
            kind: "mcp.response",
            requestId: 1,
            durationMs: 12,
            result: { temp: 22 },
          },
          // unsupported legacy events should be dropped, not throw
          { kind: "widget.intent", name: "ui/setSomething", params: {} },
          {
            kind: "csp.violation",
            directive: "script-src",
            blockedUri: "x",
            severity: "high",
          },
        ],
      },
    };
    const trace = loadTrace(legacy);
    expect(trace.schemaVersion).toBe(SCHEMA_VERSION);
    expect(trace.name).toBe("Old recording");
    // 5 known kinds preserved (incl. widget.intent); csp.violation dropped.
    expect(trace.steps).toHaveLength(5);
    // The mcp.response gets `tool` synthesized from the matching request
    // and then folded — so we should see `tools.weather.lastResult`.
    const last = trace.steps[trace.steps.length - 1];
    expect(last.stateAfter.tools.weather.lastResult).toEqual({ temp: 22 });
    expect(last.stateAfter.tools.weather.callCount).toBe(1);
    // widget.intent is the last step; it folds into widgets.intents.
    expect(last.stateAfter.widgets.intents).toEqual([
      { name: "ui/setSomething", params: {} },
    ]);
  });

  it("loadTrace__throws_on_unrecognised_shape", () => {
    expect(() => loadTrace({ foo: "bar" })).toThrow(/unrecognised shape/);
    expect(() => loadTrace(null)).toThrow(/must be an object/);
  });

  it("toTrace__round_trips_through_loadTrace", () => {
    const timeline: Recorded[] = [
      {
        relMs: 0,
        kind: "mcp.request",
        id: 1,
        source: "user",
        method: "tools/call",
        params: { name: "get_weather", arguments: { city: "Tokyo" } },
      },
      {
        relMs: 5,
        kind: "mcp.response",
        requestId: 1,
        durationMs: 12,
        result: { temp: 22 },
      },
    ];
    const trace = toTrace({ timeline, name: "weather" });
    const reloaded = loadTrace(saveTrace(trace));
    expect(reloaded.name).toBe("weather");
    expect(reloaded.steps).toHaveLength(2);
    // After folding, the response's tool is attributed via pairing.
    const last = reloaded.steps[1].stateAfter;
    expect(last.tools.get_weather.callCount).toBe(1);
    expect(last.tools.get_weather.lastResult).toEqual({ temp: 22 });
  });

  it("loadTrace__migrates_widget_render_to_action_with_mock", () => {
    const legacy = {
      id: "render-test",
      name: "render flow",
      createdAt: "2026-01-01T00:00:00.000Z",
      session: {
        timeline: [
          {
            kind: "widget.render",
            name: "goal_detail",
            htmlHash: "abc123",
            initialMock: {
              toolInput: { course_id: "c1" },
              toolOutput: { lessons: [] },
              _meta: { "openai/widgetAccessible": true },
              widgetState: null,
            },
          },
        ],
      },
    };
    const trace = loadTrace(legacy);
    expect(trace.steps).toHaveLength(1);
    const step = trace.steps[0];
    expect(step.action).toMatchObject({
      driver: "widget",
      kind: "render",
      source: "user",
      payload: {
        widgetName: "goal_detail",
        mock: {
          toolInput: { course_id: "c1" },
          toolOutput: { lessons: [] },
          meta: { "openai/widgetAccessible": true },
          widgetState: null,
        },
      },
    });
    expect(step.stateAfter.widgets.activeRender?.widgetName).toBe(
      "goal_detail",
    );
  });

  it("toTrace__synthesizes_tool_names_on_responses", () => {
    const timeline: Recorded[] = [
      {
        relMs: 0,
        kind: "mcp.request",
        id: 7,
        source: "user",
        method: "tools/call",
        params: { name: "submit_answer", arguments: {} },
      },
      {
        relMs: 1,
        kind: "mcp.response",
        requestId: 7,
        durationMs: 1,
        result: { is_correct: true },
      },
    ];
    const trace = toTrace({ timeline, name: "x" });
    expect(trace.steps[1].stateAfter.tools.submit_answer.lastResult).toEqual({
      is_correct: true,
    });
  });
});
