import { describe, expect, it, vi } from "vitest";
import { studioDispatch } from "./studio";
import { mcpDispatch, mcpAttach } from "./mcp";
import { widgetDispatch, widgetAttach } from "./widget";
import { studioAction, mcpAction, widgetAction } from "../__tests__/fixtures";
import type { BusEntry } from "./mcp";

describe("studioDispatch", () => {
  it("routes each kind to the matching deps method", async () => {
    const select = vi.fn();
    const setArgs = vi.fn();
    const setConfig = vi.fn();
    const setMock = vi.fn();
    const dispatch = studioDispatch({ select, setArgs, setConfig, setMock });

    await dispatch(
      studioAction("select", { selection: { type: "tool", name: "x" } }),
    );
    await dispatch(studioAction("set_args", { value: { city: "Tokyo" } }));
    await dispatch(studioAction("set_config", { patch: { theme: "light" } }));
    await dispatch(studioAction("set_mock", { value: { x: 1 } }));

    expect(select).toHaveBeenCalledWith({ type: "tool", name: "x" });
    expect(setArgs).toHaveBeenCalledWith({ city: "Tokyo" });
    expect(setConfig).toHaveBeenCalledWith({ theme: "light" });
    expect(setMock).toHaveBeenCalledWith({ x: 1 });
  });
});

describe("mcpDispatch", () => {
  it("calls deps.call for user-source requests", async () => {
    const call = vi.fn(async () => undefined);
    const dispatch = mcpDispatch({
      call,
      onBusEmit: () => () => undefined,
    });
    await dispatch(
      mcpAction("request", {
        id: 1,
        method: "tools/call",
        params: { name: "weather" },
      }),
    );
    expect(call).toHaveBeenCalledWith("tools/call", { name: "weather" });
  });

  it("does not call for widget-source requests (iframe fires its own)", async () => {
    const call = vi.fn();
    const dispatch = mcpDispatch({
      call,
      onBusEmit: () => () => undefined,
    });
    await dispatch(
      mcpAction(
        "request",
        { id: 1, method: "tools/call", params: { name: "x" } },
        "widget",
      ),
    );
    expect(call).not.toHaveBeenCalled();
  });
});

describe("mcpAttach", () => {
  it("translates widget-source requests on the bus into Actions", () => {
    let busHandler: (e: BusEntry) => void = () => undefined;
    const attach = mcpAttach({
      call: async () => undefined,
      onBusEmit: (h) => {
        busHandler = h;
        return () => undefined;
      },
    });
    const emitted: unknown[] = [];
    attach((a) => emitted.push(a));
    busHandler({
      kind: "mcp.request",
      id: 1,
      source: "widget",
      method: "tools/call",
      params: { name: "submit" },
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      driver: "mcp",
      kind: "request",
      source: "widget",
      payload: { id: 1, method: "tools/call" },
    });
  });

  it("translates mcp.response bus events into Actions", () => {
    let busHandler: (e: BusEntry) => void = () => undefined;
    const attach = mcpAttach({
      call: async () => undefined,
      onBusEmit: (h) => {
        busHandler = h;
        return () => undefined;
      },
    });
    const emitted: unknown[] = [];
    attach((a) => emitted.push(a));
    busHandler({
      kind: "mcp.response",
      requestId: 1,
      durationMs: 10,
      result: { ok: true },
    });
    expect(emitted[0]).toMatchObject({
      driver: "mcp",
      kind: "response",
      payload: { requestId: 1, durationMs: 10, result: { ok: true } },
    });
  });

  it("pairs tool name onto responses from preceding tools/call requests", () => {
    let busHandler: (e: BusEntry) => void = () => undefined;
    const attach = mcpAttach({
      call: async () => undefined,
      onBusEmit: (h) => {
        busHandler = h;
        return () => undefined;
      },
    });
    const emitted: unknown[] = [];
    attach((a) => emitted.push(a));
    // User-source request (engine drove it, bus echoed) — not appended,
    // but its tool name is tracked.
    busHandler({
      kind: "mcp.request",
      id: 7,
      source: "user",
      method: "tools/call",
      params: { name: "get_weather", arguments: { city: "London" } },
    });
    expect(emitted).toHaveLength(0);
    busHandler({
      kind: "mcp.response",
      requestId: 7,
      durationMs: 12,
      result: { content: [{ text: "ok" }] },
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      driver: "mcp",
      kind: "response",
      payload: { requestId: 7, tool: "get_weather" },
    });
  });
});

describe("widgetDispatch", () => {
  it("calls mount on opened actions", async () => {
    const mount = vi.fn(async () => undefined);
    const dispatch = widgetDispatch({
      mount,
      bridge: { dispatch: async () => undefined },
      onBusEmit: () => () => undefined,
    });
    await dispatch(
      widgetAction("opened", { uri: "ui://x.html", data: { v: 1 } }),
    );
    expect(mount).toHaveBeenCalledWith("ui://x.html");
  });

  it("dispatches dom.click through bridge with the selectors", async () => {
    const bridge = { dispatch: vi.fn(async () => undefined) };
    const dispatch = widgetDispatch({
      mount: async () => undefined,
      bridge,
      onBusEmit: () => () => undefined,
    });
    await dispatch(
      widgetAction("dom.click", { selectors: { testid: "submit" } }),
    );
    expect(bridge.dispatch).toHaveBeenCalledWith(
      { testid: "submit" },
      "dom.click",
      expect.objectContaining({ selectors: { testid: "submit" } }),
    );
  });

  it("does not call dispatch for runtime_error (observed only)", async () => {
    const bridge = { dispatch: vi.fn() };
    const mount = vi.fn();
    const dispatch = widgetDispatch({
      mount,
      bridge,
      onBusEmit: () => () => undefined,
    });
    await dispatch(widgetAction("runtime_error", { message: "boom" }));
    expect(mount).not.toHaveBeenCalled();
    expect(bridge.dispatch).not.toHaveBeenCalled();
  });
});

describe("widgetAttach", () => {
  it("does NOT echo widget.dom.* bus events into ambient", () => {
    // The engine drives DOM events itself via dispatch; echoing them
    // back from the bridge's capture-phase listener would put a
    // duplicate dom.click in ambient that a later step's await would
    // wrongly consume.
    let busHandler: (e: BusEntry) => void = () => undefined;
    const attach = widgetAttach({
      mount: async () => undefined,
      bridge: { dispatch: async () => undefined },
      applyMock: async () => undefined,
      onBusEmit: (h) => {
        busHandler = h;
        return () => undefined;
      },
    });
    const emitted: unknown[] = [];
    attach((a) => emitted.push(a));
    busHandler({
      kind: "widget.dom.click",
      selectors: { testid: "submit" },
    });
    expect(emitted).toEqual([]);
  });

  it("emits runtime_error when render.complete reports errors", () => {
    let busHandler: (e: BusEntry) => void = () => undefined;
    const attach = widgetAttach({
      mount: async () => undefined,
      bridge: { dispatch: async () => undefined },
      onBusEmit: (h) => {
        busHandler = h;
        return () => undefined;
      },
    });
    const emitted: unknown[] = [];
    attach((a) => emitted.push(a));
    busHandler({
      kind: "widget.render.complete",
      hasRuntimeErrors: true,
      bodyChars: 100,
      handshakeOk: false,
      renderDurationMs: 10,
    });
    expect(emitted[0]).toMatchObject({
      driver: "widget",
      kind: "runtime_error",
    });
  });

  it("ignores render.complete without errors", () => {
    let busHandler: (e: BusEntry) => void = () => undefined;
    const attach = widgetAttach({
      mount: async () => undefined,
      bridge: { dispatch: async () => undefined },
      onBusEmit: (h) => {
        busHandler = h;
        return () => undefined;
      },
    });
    const emitted: unknown[] = [];
    attach((a) => emitted.push(a));
    busHandler({
      kind: "widget.render.complete",
      hasRuntimeErrors: false,
      bodyChars: 100,
      handshakeOk: true,
      renderDurationMs: 10,
    });
    expect(emitted).toHaveLength(0);
  });
});
