import { describe, it, expect, beforeEach } from "vitest";
import { eventBus } from "./bus";
import { ToolsCallEvent } from "./tools_call";
import type { Action } from "@/lib/action/types";

function makeFakeAction(): Action {
  return {
    id: "fake",
    type: "FAKE",
    data: {},
    timestamp: 0,
    events: [],
  } as unknown as Action;
}

describe("eventBus", () => {
  beforeEach(() => {
    eventBus.setActive(null);
  });

  it("drops emissions when no Action is active", () => {
    const ev = new ToolsCallEvent("noop", {}, { success: true, data: null });
    expect(() => eventBus.emit(ev)).not.toThrow();
    expect(eventBus.current()).toBeNull();
  });

  it("routes emit() into the active Action's events list", () => {
    const a = makeFakeAction();
    eventBus.setActive(a);

    const e1 = new ToolsCallEvent("a", {}, { success: true });
    const e2 = new ToolsCallEvent(
      "b",
      {},
      { success: false, error: { message: "x" } },
    );
    eventBus.emit(e1);
    eventBus.emit(e2);

    expect(a.events).toEqual([e1, e2]);
  });

  it("stops routing after setActive(null)", () => {
    const a = makeFakeAction();
    eventBus.setActive(a);
    eventBus.emit(new ToolsCallEvent("first", {}, { success: true }));
    eventBus.setActive(null);
    eventBus.emit(new ToolsCallEvent("second", {}, { success: true }));

    expect(a.events).toHaveLength(1);
  });

  it("switches active Action — only the newest receives subsequent events", () => {
    const a1 = makeFakeAction();
    const a2 = makeFakeAction();

    eventBus.setActive(a1);
    eventBus.emit(new ToolsCallEvent("to-a1", {}, { success: true }));

    eventBus.setActive(a2);
    eventBus.emit(new ToolsCallEvent("to-a2", {}, { success: true }));

    expect(a1.events).toHaveLength(1);
    expect(a2.events).toHaveLength(1);
    expect((a1.events[0].data as { tool: string }).tool).toBe("to-a1");
    expect((a2.events[0].data as { tool: string }).tool).toBe("to-a2");
  });
});
