import { describe, it, expect } from "vitest";
import { ToolCallAction } from "./tool_call";
import {
  ToolCallRequestedEvent,
  ToolCallCompletedEvent,
} from "@/lib/event/tool_events";
import { createInitialState, applyEvent, applyEvents } from "@/lib/state/types";
import {
  assertActionSucceeded,
  assertStateChanged,
} from "@/lib/assertion/assert";

describe("ToolCallAction", () => {
  it("executes and produces events", () => {
    const action = new ToolCallAction("get_weather", { city: "SF" });

    // Verify action succeeded (pure check)
    assertActionSucceeded(action);

    const events = action.execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(ToolCallRequestedEvent);
  });

  it("updates state correctly on request", () => {
    const action = new ToolCallAction("get_weather", { city: "SF" });
    const events = action.execute();

    const before = createInitialState();
    const after = applyEvent(before, events[0]);

    // Verify state changed
    assertStateChanged(before, after, "tools.get_weather");
    assertStateChanged(before, after, "network.requestCount");

    // Check specific values
    expect(after.tools["get_weather"]).toBeDefined();
    expect(after.tools["get_weather"].callCount).toBe(1);
    expect(after.tools["get_weather"].calls).toHaveLength(1);
    expect(after.network.requestCount).toBe(1);
  });

  it("updates state correctly on completion", () => {
    const action = new ToolCallAction("get_weather", { city: "SF" });
    const requestEvents = action.execute();

    let state = createInitialState();
    state = applyEvent(state, requestEvents[0]);

    // Get the requestId from the state
    const requestId = state.tools["get_weather"].calls[0].requestId;

    // Simulate completion event
    const completedEvent = new ToolCallCompletedEvent({
      requestId,
      tool: "get_weather",
      result: { temperature: 72, condition: "sunny" },
    });

    const before = state;
    const after = applyEvent(state, completedEvent);

    // Verify state changed
    assertStateChanged(before, after, "tools.get_weather.lastResult");
    assertStateChanged(before, after, "network.responseCount");

    // Check result was stored
    expect(after.tools["get_weather"].lastResult).toEqual({
      temperature: 72,
      condition: "sunny",
    });
    expect(after.tools["get_weather"].calls[0].result).toEqual({
      temperature: 72,
      condition: "sunny",
    });
    expect(after.network.responseCount).toBe(1);
  });

  it("handles full action → event → state flow", () => {
    // 1. Create and execute action
    const action = new ToolCallAction("get_weather", { city: "SF" });
    assertActionSucceeded(action);

    // 2. Apply request event
    let state = createInitialState();
    const requestEvents = action.execute();
    state = applyEvents(state, requestEvents);

    // 3. Verify request updated state
    expect(state.tools["get_weather"].callCount).toBe(1);
    expect(state.network.requestCount).toBe(1);

    // 4. Simulate response
    const requestId = state.tools["get_weather"].calls[0].requestId;
    const completedEvent = new ToolCallCompletedEvent({
      requestId,
      tool: "get_weather",
      result: { temperature: 72 },
    });

    // 5. Apply response event
    const beforeResponse = state;
    state = applyEvent(state, completedEvent);

    // 6. Verify completion updated state
    assertStateChanged(beforeResponse, state, "tools.get_weather.lastResult");
    expect(state.tools["get_weather"].lastResult).toEqual({ temperature: 72 });
    expect(state.network.responseCount).toBe(1);
  });
});
