import { describe, expect, it, vi } from "vitest";
import { run } from "./engine";
import { studioDriver } from "./drivers/studio";
import { mcpDriver } from "./drivers/mcp";
import { widgetDriver } from "./drivers/widget";
import {
  studioAction,
  emptyState,
  makeTrace,
  mcpAction,
  widgetAction,
} from "./__tests__/fixtures";
import type { Action, Driver } from "./types";

const realDrivers = [studioDriver, mcpDriver, widgetDriver] as Driver[];

function driversWith(overrides: {
  dispatch?: (a: Action) => void | Promise<void>;
  attach?: (emit: (a: Action) => void) => () => void;
}): Driver[] {
  return realDrivers.map((d) => ({
    ...d,
    dispatch: overrides.dispatch
      ? async (a) => overrides.dispatch!(a)
      : undefined,
    attach: overrides.attach ? (emit) => overrides.attach!(emit) : undefined,
  }));
}

describe("engine.run", () => {
  it("run__drives_user_actions_and_appends_to_trace", async () => {
    const dispatched: string[] = [];
    const drivers = driversWith({
      dispatch: (a) => void dispatched.push(a.kind),
    });
    const trace = makeTrace({
      steps: [
        {
          action: studioAction("set_args", { value: { x: 1 } }),
          stateAfter: emptyState(),
        },
        {
          action: studioAction("select", {
            selection: { type: "tool", name: "weather" },
          }),
          stateAfter: emptyState(),
        },
      ],
    });
    const out = await run(trace, {
      signal: new AbortController().signal,
      drivers,
    });
    expect(dispatched).toEqual(["set_args", "select"]);
    expect(out.steps).toHaveLength(2);
    expect(out.steps[1].stateAfter.studio.selected?.name).toBe("weather");
  });

  it("run__captures_state_via_apply_action_per_step", async () => {
    const drivers = driversWith({ dispatch: () => undefined });
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
      ],
    });
    const out = await run(trace, {
      signal: new AbortController().signal,
      drivers,
    });
    expect(out.steps[0].stateAfter.tools.weather.callCount).toBe(1);
    expect(out.steps[0].stateAfter.network.requestCount).toBe(1);
  });

  it("run__drains_ambient_actions_before_next_user_step", async () => {
    let emitFn: ((a: Action) => void) | null = null;
    // First user dispatch emits an ambient action; the engine should
    // drain it before dispatching the second user action.
    const drivers = driversWith({
      dispatch: (a) => {
        if (a.kind === "set_args") {
          emitFn?.(
            mcpAction("response", {
              requestId: 1,
              tool: "weather",
              durationMs: 1,
              result: { temp: 22 },
            }),
          );
        }
      },
      attach: (emit) => {
        emitFn = emit;
        return () => undefined;
      },
    });
    const out = await run(
      makeTrace({
        steps: [
          {
            action: studioAction("set_args", { value: { x: 1 } }),
            stateAfter: emptyState(),
          },
          {
            action: studioAction("select", {
              selection: { type: "tool", name: "weather" },
            }),
            stateAfter: emptyState(),
          },
        ],
      }),
      { signal: new AbortController().signal, drivers },
    );
    // Order: user set_args → ambient response (drained) → user select.
    expect(out.steps.map((s) => s.action.kind)).toEqual([
      "set_args",
      "response",
      "select",
    ]);
  });

  it("run__times_out_when_awaited_action_does_not_arrive", async () => {
    const drivers = driversWith({ dispatch: () => undefined });
    // A trace expecting a server-source response that never comes.
    const trace = makeTrace({
      steps: [
        {
          action: mcpAction("response", {
            requestId: 1,
            tool: "weather",
            durationMs: 1,
            result: {},
          }),
          stateAfter: emptyState(),
        },
      ],
    });
    const out = await run(trace, {
      signal: new AbortController().signal,
      drivers,
      awaitMs: 30,
    });
    // Step never landed; the captured trace is shorter than the expected
    // recorded one. Differ will catch it as step_missing.
    expect(out.steps).toEqual([]);
  });

  it("run__aborts_cleanly_when_signal_fires_between_steps", async () => {
    const ctrl = new AbortController();
    // First dispatch aborts the controller, so the engine breaks out
    // of the loop before driving the second step.
    const drivers = driversWith({
      dispatch: () => {
        ctrl.abort();
      },
    });
    const trace = makeTrace({
      steps: [
        {
          action: studioAction("set_args", { value: {} }),
          stateAfter: emptyState(),
        },
        {
          action: studioAction("select", {
            selection: { type: "tool", name: "weather" },
          }),
          stateAfter: emptyState(),
        },
      ],
    });
    const out = await run(trace, { signal: ctrl.signal, drivers });
    expect(out.steps.map((s) => s.action.kind)).toEqual(["set_args"]);
  });

  it("run__handles_empty_trace_returning_empty_capture", async () => {
    const drivers = driversWith({});
    const out = await run(makeTrace({ steps: [] }), {
      signal: new AbortController().signal,
      drivers,
    });
    expect(out.steps).toEqual([]);
  });

  it("run__detaches_drivers_when_done", async () => {
    const detach = vi.fn();
    const drivers = driversWith({
      dispatch: () => undefined,
      attach: () => detach,
    });
    await run(
      makeTrace({
        steps: [
          {
            action: studioAction("set_args", { value: {} }),
            stateAfter: emptyState(),
          },
        ],
      }),
      { signal: new AbortController().signal, drivers },
    );
    // attach is registered for each of the three drivers; detach is the
    // same fn returned thrice → called thrice on cleanup.
    expect(detach).toHaveBeenCalledTimes(3);
  });
});
