import { describe, it, expect, beforeEach } from "vitest";
import { recorder } from "./bus";
import { ToolCallAction } from "@/lib/action/tool_call";
import { ResourceReadAction } from "@/lib/action/resource_read";

describe("Recording new Actions", () => {
  beforeEach(() => {
    // Start recording before each test
    recorder.start({ url: "http://localhost:3000" });
  });

  it("records tool call actions", () => {
    const action = new ToolCallAction("get_weather", { city: "SF" });

    // Record the action
    recorder.record(action);

    // Check it was recorded
    const snapshot = recorder.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].action.type).toBe("TOOL_CALL");
    expect(snapshot[0].action.data).toEqual({
      tool: "get_weather",
      params: { city: "SF" },
    });
  });

  it("records resource read actions", () => {
    const action = new ResourceReadAction("widget://test-widget");

    recorder.record(action);

    const snapshot = recorder.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].action.type).toBe("RESOURCE_READ");
    expect(snapshot[0].action.data).toEqual({ uri: "widget://test-widget" });
  });

  it("records multiple actions", () => {
    const action1 = new ToolCallAction("get_weather", { city: "SF" });
    const action2 = new ToolCallAction("get_weather", { city: "NYC" });
    const action3 = new ResourceReadAction("widget://test");

    recorder.record(action1);
    recorder.record(action2);
    recorder.record(action3);

    const snapshot = recorder.snapshot();
    expect(snapshot).toHaveLength(3);
  });

  it("can serialize to session", () => {
    const action = new ToolCallAction("get_weather", { city: "SF" });
    recorder.record(action);

    const session = recorder.stop();

    expect(session.version).toBe(2);
    expect(session.actions).toHaveLength(1);
    expect(session.actions[0].action.type).toBe("TOOL_CALL");
    expect(session.setup.url).toBe("http://localhost:3000");
  });

  it("normalizes timing when serializing range", () => {
    recorder.record(new ToolCallAction("tool1", {}));
    // Wait a bit
    recorder.record(new ToolCallAction("tool2", {}));

    const session = recorder.serializeRange(0, 2);

    // First action should start at t=0
    expect(session.actions[0].relMs).toBe(0);
    // Second action should have positive offset
    expect(session.actions[1].relMs).toBeGreaterThanOrEqual(0);
  });
});
