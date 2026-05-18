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

  it("run__times_out_with_synthetic_placeholder_when_awaited_action_does_not_arrive", async () => {
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
    // Engine pushes a synthetic placeholder so subsequent indices stay
    // aligned with the recorded trace. The differ recognizes
    // synthetic=true and surfaces this as a warn step_missing.
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]).toMatchObject({
      action: { driver: "mcp", kind: "response" },
      synthetic: true,
    });
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

  it("run__fires_onStepStart_before_each_step", async () => {
    const drivers = driversWith({ dispatch: () => undefined });
    const events: Array<[number, string, number]> = [];
    const trace = makeTrace({
      steps: [
        {
          action: studioAction("set_args", { value: {} }),
          stateAfter: emptyState(),
        },
        {
          action: studioAction("select", {
            selection: { type: "tool", name: "w" },
          }),
          stateAfter: emptyState(),
        },
      ],
    });
    await run(trace, {
      signal: new AbortController().signal,
      drivers,
      onStepStart: (i, a, total) => events.push([i, a.kind, total]),
    });
    expect(events).toEqual([
      [0, "set_args", 2],
      [1, "select", 2],
    ]);
  });

  it("run__fires_onStepDone_after_each_pushed_step", async () => {
    const drivers = driversWith({ dispatch: () => undefined });
    const done: number[] = [];
    const trace = makeTrace({
      steps: [
        {
          action: studioAction("set_args", { value: {} }),
          stateAfter: emptyState(),
        },
        {
          action: studioAction("set_args", { value: { x: 2 } }),
          stateAfter: emptyState(),
        },
      ],
    });
    await run(trace, {
      signal: new AbortController().signal,
      drivers,
      onStepDone: (i, step) => {
        done.push(i);
        expect(step.action.kind).toBe("set_args");
      },
    });
    expect(done).toEqual([0, 1]);
  });

  it("run__awaits_beforeStep_gate_until_user_resolves", async () => {
    const drivers = driversWith({ dispatch: () => undefined });
    const trace = makeTrace({
      steps: [
        {
          action: studioAction("set_args", { value: {} }),
          stateAfter: emptyState(),
        },
        {
          action: studioAction("set_args", { value: { x: 1 } }),
          stateAfter: emptyState(),
        },
      ],
    });
    const gates: Array<() => void> = [];
    const runPromise = run(trace, {
      signal: new AbortController().signal,
      drivers,
      beforeStep: () => new Promise<void>((resolve) => gates.push(resolve)),
    });
    // Wait a tick so the engine reaches the first beforeStep call.
    await new Promise((r) => setTimeout(r, 10));
    expect(gates).toHaveLength(1);
    gates[0]();
    await new Promise((r) => setTimeout(r, 10));
    expect(gates).toHaveLength(2);
    gates[1]();
    const out = await runPromise;
    expect(out.steps).toHaveLength(2);
  });

  it("run__abort_via_signal_during_beforeStep_breaks_loop_cleanly", async () => {
    const drivers = driversWith({ dispatch: () => undefined });
    const trace = makeTrace({
      steps: [
        {
          action: studioAction("set_args", { value: {} }),
          stateAfter: emptyState(),
        },
        {
          action: studioAction("set_args", { value: { x: 2 } }),
          stateAfter: emptyState(),
        },
      ],
    });
    const ctrl = new AbortController();
    let resolveStep2: (() => void) | null = null;
    let beforeStepCalls = 0;
    const runPromise = run(trace, {
      signal: ctrl.signal,
      drivers,
      beforeStep: () => {
        beforeStepCalls++;
        if (beforeStepCalls === 1) return Promise.resolve();
        return new Promise<void>((resolve) => {
          resolveStep2 = resolve;
        });
      },
    });
    // Let the engine reach step 2's beforeStep gate.
    await new Promise((r) => setTimeout(r, 10));
    expect(beforeStepCalls).toBe(2);
    // Abort while paused at step 2, then drain the gate.
    ctrl.abort();
    resolveStep2?.();
    const out = await runPromise;
    // Engine completed step 1 but bailed before step 2's dispatch.
    expect(out.steps).toHaveLength(1);
  });
});
