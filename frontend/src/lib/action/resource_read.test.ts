import { describe, it, expect } from "vitest";
import { ResourceReadAction } from "./resource_read";
import {
  ResourceReadRequestedEvent,
  ResourceReadCompletedEvent,
} from "@/lib/event/resource_events";
import { createInitialState, applyEvent, applyEvents } from "@/lib/state/types";
import {
  assertActionSucceeded,
  assertStateChanged,
} from "@/lib/assertion/assert";

describe("ResourceReadAction", () => {
  it("executes and produces events", () => {
    const action = new ResourceReadAction("widget://test-widget");

    assertActionSucceeded(action);

    const events = action.execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(ResourceReadRequestedEvent);
  });

  it("updates state correctly on request", () => {
    const uri = "widget://test-widget";
    const action = new ResourceReadAction(uri);
    const events = action.execute();

    const before = createInitialState();
    const after = applyEvent(before, events[0]);

    // Verify state changed
    assertStateChanged(before, after, `resources.${uri}`);
    assertStateChanged(before, after, "network.requestCount");

    // Check specific values
    expect(after.resources[uri]).toBeDefined();
    expect(after.resources[uri].readCount).toBe(1);
    expect(after.resources[uri].reads).toHaveLength(1);
    expect(after.network.requestCount).toBe(1);
  });

  it("updates state correctly on completion", () => {
    const uri = "widget://test-widget";
    const action = new ResourceReadAction(uri);
    const requestEvents = action.execute();

    let state = createInitialState();
    state = applyEvent(state, requestEvents[0]);

    const requestId = state.resources[uri].reads[0].requestId;

    // Simulate completion event
    const completedEvent = new ResourceReadCompletedEvent({
      requestId,
      uri,
      result: { html: "<div>Widget HTML</div>", mimeType: "text/html" },
    });

    const before = state;
    const after = applyEvent(state, completedEvent);

    // Verify state changed
    assertStateChanged(before, after, `resources.${uri}.lastResult`);
    assertStateChanged(before, after, "network.responseCount");

    // Check result was stored
    expect(after.resources[uri].lastResult).toEqual({
      html: "<div>Widget HTML</div>",
      mimeType: "text/html",
    });
    expect(after.network.responseCount).toBe(1);
  });

  it("handles full action → event → state flow", () => {
    const uri = "widget://test-widget";

    // 1. Create and execute action
    const action = new ResourceReadAction(uri);
    assertActionSucceeded(action);

    // 2. Apply request event
    let state = createInitialState();
    const requestEvents = action.execute();
    state = applyEvents(state, requestEvents);

    // 3. Verify request updated state
    expect(state.resources[uri].readCount).toBe(1);
    expect(state.network.requestCount).toBe(1);

    // 4. Simulate response
    const requestId = state.resources[uri].reads[0].requestId;
    const completedEvent = new ResourceReadCompletedEvent({
      requestId,
      uri,
      result: { html: "<div>Test</div>" },
    });

    // 5. Apply response event
    const beforeResponse = state;
    state = applyEvent(state, completedEvent);

    // 6. Verify completion updated state
    assertStateChanged(beforeResponse, state, `resources.${uri}.lastResult`);
    expect(state.resources[uri].lastResult).toEqual({
      html: "<div>Test</div>",
    });
    expect(state.network.responseCount).toBe(1);
  });
});
