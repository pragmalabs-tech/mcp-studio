import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/studio/api", () => ({
  callTool: vi.fn(),
  readResource: vi.fn(),
}));

vi.mock("@/lib/studio/store", () => {
  const state: Record<string, unknown> = {
    logAction: vi.fn(),
    insertWidget: vi.fn(),
    resources: [],
    theme: "dark",
    locale: "en-US",
    displayMode: "compact",
    widgetCache: {},
  };
  return {
    useStudioStore: {
      getState: () => state,
      setState: (patch: object | ((s: object) => object)) => {
        const next = typeof patch === "function" ? patch(state) : patch;
        Object.assign(state, next);
      },
    },
  };
});

import { recorder } from "./bus";
import { ToolCallAction } from "@/lib/action/tool_call";
import { ResourceReadAction } from "@/lib/action/resource_read";
import { SCHEMA_VERSION } from "./schema";

describe("Recording new Actions", () => {
  beforeEach(() => {
    recorder.start({ url: "http://localhost:3000" });
  });

  it("records tool call actions", () => {
    const action = new ToolCallAction("get_weather", { city: "SF" });
    recorder.record(action);

    const snapshot = recorder.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].action.type).toBe("TOOL_CALL");
    expect(snapshot[0].action.data).toEqual({
      tool: "get_weather",
      params: { city: "SF" },
    });
  });

  it("records the waitMs override when provided", () => {
    const action = new ToolCallAction("get_weather", { city: "SF" }, 400);
    recorder.record(action);

    expect(recorder.snapshot()[0].action.data).toEqual({
      tool: "get_weather",
      params: { city: "SF" },
      waitMs: 400,
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
    recorder.record(new ToolCallAction("get_weather", { city: "SF" }));
    recorder.record(new ToolCallAction("get_weather", { city: "NYC" }));
    recorder.record(new ResourceReadAction("widget://test"));

    expect(recorder.snapshot()).toHaveLength(3);
  });

  it("can serialize to session at current schema version", () => {
    const action = new ToolCallAction("get_weather", { city: "SF" });
    recorder.record(action);

    const session = recorder.stop();

    expect(session.version).toBe(SCHEMA_VERSION);
    expect(session.actions).toHaveLength(1);
    expect(session.actions[0].action.type).toBe("TOOL_CALL");
    expect(session.setup.url).toBe("http://localhost:3000");
  });

  it("normalizes timing when serializing range", () => {
    recorder.record(new ToolCallAction("tool1", {}));
    recorder.record(new ToolCallAction("tool2", {}));

    const session = recorder.serializeRange(0, 2);

    expect(session.actions[0].relMs).toBe(0);
    expect(session.actions[1].relMs).toBeGreaterThanOrEqual(0);
  });
});
