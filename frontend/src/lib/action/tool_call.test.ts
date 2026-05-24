import { describe, it, expect, vi, beforeEach } from "vitest";

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
    widgetCache: {} as Record<string, string>,
    resultIssues: [],
    lastResult: null,
    jsonOutput: null,
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

import { ToolCallAction } from "./tool_call";
import { callTool, readResource } from "@/lib/studio/api";
import { useStudioStore } from "@/lib/studio/store";

const mockedCallTool = vi.mocked(callTool);
const mockedReadResource = vi.mocked(readResource);

function resetStore() {
  const s = useStudioStore.getState() as unknown as Record<string, unknown>;
  s.logAction = vi.fn();
  s.insertWidget = vi.fn();
  s.resources = [];
  s.theme = "dark";
  s.locale = "en-US";
  s.displayMode = "compact";
  s.widgetCache = {};
  s.resultIssues = [];
  s.lastResult = null;
  s.jsonOutput = null;
}

describe("ToolCallAction", () => {
  beforeEach(() => {
    mockedCallTool.mockReset();
    mockedReadResource.mockReset();
    resetStore();
  });

  it("wraps non-widget tool response under data.tool and ticks no widget counter", async () => {
    mockedCallTool.mockResolvedValueOnce({ temperature: 72 });
    const action = new ToolCallAction("get_weather", { city: "SF" });

    await action.execute();

    expect(mockedCallTool).toHaveBeenCalledWith("get_weather", { city: "SF" });
    expect(action.result?.success).toBe(true);
    expect(action.result?.data).toEqual({
      tool: { temperature: 72 },
      widget: null,
      widgetId: null,
      snapshot: null,
    });
    expect(action.change()).toEqual({
      tools: { get_weather: { callCount: 1 } },
      network: { requestCount: 1, responseCount: 1, errorCount: 0 },
    });
  });

  it("populates error result and bumps errorCount on tool failure", async () => {
    mockedCallTool.mockRejectedValueOnce(new Error("boom"));
    const action = new ToolCallAction("get_weather", { city: "SF" });

    await action.execute();

    expect(action.result).toEqual({
      success: false,
      data: undefined,
      error: { message: "boom" },
    });
    expect(action.change()).toEqual({
      tools: { get_weather: { callCount: 1 } },
      network: { requestCount: 1, responseCount: 0, errorCount: 1 },
    });
  });

  it("registers the widget and ticks renderCount when the tool returns widget meta", async () => {
    const widgetUri = "ui://widget/weather";
    mockedCallTool.mockResolvedValueOnce({
      _meta: { ui: { resourceUri: widgetUri } },
      structuredContent: { temperature: 72 },
    });
    mockedReadResource.mockResolvedValueOnce({
      contents: [{ text: "<html><body>widget</body></html>" }],
    });

    const insertWidget = vi.fn().mockResolvedValue("<snapshot>");
    const s = useStudioStore.getState() as unknown as Record<string, unknown>;
    s.resources = [
      {
        uri: widgetUri,
        mimeType: "text/html;profile=mcp-app",
        name: "weather",
      },
    ];
    s.insertWidget = insertWidget;

    const action = new ToolCallAction("get_weather", { city: "SF" }, 10);
    await action.execute();

    expect(mockedReadResource).toHaveBeenCalledWith(widgetUri);
    expect(insertWidget).toHaveBeenCalledOnce();
    const [id, entry] = insertWidget.mock.calls[0];
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(entry.html).toContain("widget");
    expect(entry.waitMs).toBe(10);

    expect(action.result?.data).toMatchObject({
      widget: widgetUri,
      widgetId: id,
      snapshot: "<snapshot>",
    });
    expect(action.change()).toEqual({
      tools: { get_weather: { callCount: 1 } },
      network: { requestCount: 1, responseCount: 1, errorCount: 0 },
      widgets: { [widgetUri]: { renderCount: 1, clickCount: 0 } },
    });
  });

  it("snapshot stays null when the WidgetPreview never resolves (timeout fallback)", async () => {
    const widgetUri = "ui://widget/weather";
    mockedCallTool.mockResolvedValueOnce({
      _meta: { ui: { resourceUri: widgetUri } },
    });
    mockedReadResource.mockResolvedValueOnce({
      contents: [{ text: "<html></html>" }],
    });

    // Promise that never resolves — exercises raceWithTimeout's fallback.
    const insertWidget = vi.fn().mockReturnValue(new Promise(() => {}));
    const s = useStudioStore.getState() as unknown as Record<string, unknown>;
    s.resources = [
      {
        uri: widgetUri,
        mimeType: "text/html;profile=mcp-app",
        name: "weather",
      },
    ];
    s.insertWidget = insertWidget;

    const action = new ToolCallAction("get_weather", { city: "SF" }, 1);
    await action.execute();

    expect(action.result?.data).toMatchObject({
      widget: widgetUri,
      snapshot: null,
    });
    expect(action.change().widgets).toEqual({
      [widgetUri]: { renderCount: 1, clickCount: 0 },
    });
  });

  it("declares assertable points with paths rooted in data.tool", () => {
    const points = ToolCallAction.assertablePoints;
    const keys = points.map((p) => p.key);
    expect(keys).toContain("success");
    expect(keys).toContain("widget");
    expect(points.find((p) => p.key === "structuredContent")?.path).toBe(
      "data.tool.structuredContent",
    );
    expect(points.find((p) => p.key === "widget")?.path).toBe("data.widget");
  });

  it("verifyResult passes when result matches under default modes", async () => {
    mockedCallTool.mockResolvedValueOnce({ ok: true });
    const action = new ToolCallAction("ping", {});
    await action.execute();

    const r = action.verifyResult(
      {
        success: true,
        data: {
          tool: { ok: true },
          widget: null,
          widgetId: null,
          snapshot: null,
        },
      },
      undefined,
    );
    expect(r.status).toBe("passed");
  });

  it("verifyStateChange passes under default exact mode", async () => {
    mockedCallTool.mockResolvedValueOnce({ ok: true });
    const action = new ToolCallAction("ping", {});
    await action.execute();

    const recorded = action.change();
    const r = await action.verifyStateChange(recorded, { attempts: 1 });
    expect(r.status).toBe("passed");
  });
});
