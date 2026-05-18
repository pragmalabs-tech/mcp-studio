import { describe, expect, it } from "vitest";
import { mcpDriver } from "./mcp";
import { emptyState, makeState, mcpAction } from "../__tests__/fixtures";

describe("mcp driver", () => {
  it("initialSlice__returns_empty_record", () => {
    expect(mcpDriver.initialSlice()).toEqual({});
  });

  it("apply_request__bumps_request_count_always", () => {
    const after = mcpDriver.apply(
      emptyState(),
      mcpAction("request", { id: 1, method: "tools/list", params: {} }),
    );
    expect(after.network.requestCount).toBe(1);
  });

  it("apply_request__creates_tool_row_on_first_tools_call", () => {
    const after = mcpDriver.apply(
      emptyState(),
      mcpAction("request", {
        id: 1,
        method: "tools/call",
        params: { name: "weather", arguments: {} },
      }),
    );
    expect(after.tools.weather).toEqual({ callCount: 1 });
  });

  it("apply_request__bumps_existing_tool_callcount", () => {
    const before = makeState({ tools: { weather: { callCount: 1 } } });
    const after = mcpDriver.apply(
      before,
      mcpAction("request", {
        id: 2,
        method: "tools/call",
        params: { name: "weather", arguments: {} },
      }),
    );
    expect(after.tools.weather.callCount).toBe(2);
  });

  it("apply_request__leaves_tools_untouched_for_non_tools_call", () => {
    const before = emptyState();
    const after = mcpDriver.apply(
      before,
      mcpAction("request", {
        id: 1,
        method: "resources/read",
        params: { uri: "x" },
      }),
    );
    expect(after.tools).toBe(before.tools);
  });

  it("apply_response__bumps_response_count_and_attributes_to_tool", () => {
    const before = makeState({ tools: { weather: { callCount: 1 } } });
    const after = mcpDriver.apply(
      before,
      mcpAction("response", {
        requestId: 1,
        tool: "weather",
        durationMs: 8,
        result: { temp: 22 },
      }),
    );
    expect(after.network.responseCount).toBe(1);
    expect(after.tools.weather.lastResult).toEqual({ temp: 22 });
  });

  it("apply_response__error_envelope_bumps_errorCount_and_lastError", () => {
    const after = mcpDriver.apply(
      makeState({ tools: { weather: { callCount: 1 } } }),
      mcpAction("response", {
        requestId: 1,
        tool: "weather",
        durationMs: 5,
        error: { message: "boom" },
      }),
    );
    expect(after.network.errorCount).toBe(1);
    expect(after.tools.weather.lastError).toEqual({ message: "boom" });
  });

  it("apply_response__without_tool_only_moves_network_counters", () => {
    const before = makeState({ tools: { weather: { callCount: 1 } } });
    const after = mcpDriver.apply(
      before,
      mcpAction("response", {
        requestId: 1,
        durationMs: 1,
        result: { ok: true },
      }),
    );
    expect(after.tools).toBe(before.tools);
    expect(after.network.responseCount).toBe(1);
  });

  it("apply_response__creates_tool_row_when_referenced_tool_unseen", () => {
    const after = mcpDriver.apply(
      emptyState(),
      mcpAction("response", {
        requestId: 99,
        tool: "fresh",
        durationMs: 1,
        result: { hello: "world" },
      }),
    );
    expect(after.tools.fresh).toEqual({
      callCount: 0,
      lastResult: { hello: "world" },
    });
  });

  it("apply_response__drops_content_when_structuredContent_present", () => {
    const result = {
      structuredContent: { id: 1, name: "alpha" },
      content: [{ type: "text", text: '{"id":1,"name":"alpha"}' }],
      _meta: { duration: 5 },
    };
    const after = mcpDriver.apply(
      emptyState(),
      mcpAction("response", {
        requestId: 1,
        tool: "lookup",
        durationMs: 1,
        result,
      }),
    );
    const stored = after.tools.lookup.lastResult as Record<string, unknown>;
    expect(stored.structuredContent).toEqual({ id: 1, name: "alpha" });
    expect(stored._meta).toEqual({ duration: 5 });
    expect(stored.content).toBeUndefined();
  });

  it("apply_response__preserves_content_when_no_structuredContent", () => {
    const result = {
      content: [{ type: "text", text: "<html>hi</html>" }],
    };
    const after = mcpDriver.apply(
      emptyState(),
      mcpAction("response", {
        requestId: 1,
        tool: "widget",
        durationMs: 1,
        result,
      }),
    );
    expect(after.tools.widget.lastResult).toEqual(result);
  });

  it("volatilePaths__declares_id_and_timestamp_paths", () => {
    const paths = mcpDriver.volatilePaths();
    expect(paths).toContain("*.lastResult.id");
    expect(paths).toContain("*.lastResult.created_at");
    expect(paths).toContain("*.lastResult.data.id");
  });

  it("matchPaths__declares_iso8601_context_datetime", () => {
    const match = mcpDriver.matchPaths?.() ?? {};
    expect(
      match["*.lastResult.structuredContent.context.current_datetime"],
    ).toBe("@iso8601");
    expect(
      match["*.lastResult.structuredContent.context.current_date_human"],
    ).toBe("@any");
  });

  it("apply_request__creates_resource_row_on_resources_read", () => {
    const after = mcpDriver.apply(
      emptyState(),
      mcpAction("request", {
        id: 1,
        method: "resources/read",
        params: { uri: "ui://w.html" },
      }),
    );
    expect(after.resources["ui://w.html"]).toEqual({ readCount: 1 });
  });

  it("apply_request__bumps_existing_resource_readcount", () => {
    const before = makeState({
      resources: { "ui://w.html": { readCount: 1 } },
    });
    const after = mcpDriver.apply(
      before,
      mcpAction("request", {
        id: 2,
        method: "resources/read",
        params: { uri: "ui://w.html" },
      }),
    );
    expect(after.resources["ui://w.html"].readCount).toBe(2);
  });

  it("apply_request__leaves_resources_untouched_for_non_resources_read", () => {
    const before = emptyState();
    const after = mcpDriver.apply(
      before,
      mcpAction("request", { id: 1, method: "tools/list", params: {} }),
    );
    expect(after.resources).toBe(before.resources);
  });

  it("apply_response__projects_widget_shape_into_resources_lastResult", () => {
    const result = {
      contents: [
        {
          uri: "ui://w.html",
          mimeType: "text/html+skybridge",
          text: "<!doctype html><html><body>hi</body></html>",
          _meta: {
            "openai/widgetCSP": {
              connect_domains: ["https://api.example.com"],
              resource_domains: ["https://assets.example.com"],
              frame_domains: [],
            },
            "openai/widgetDomain": "https://widget.example.com",
          },
        },
      ],
    };
    const after = mcpDriver.apply(
      makeState({ resources: { "ui://w.html": { readCount: 1 } } }),
      mcpAction("response", {
        requestId: 1,
        method: "resources/read",
        resourceUri: "ui://w.html",
        durationMs: 5,
        result,
      }),
    );
    const stats = after.resources["ui://w.html"];
    expect(stats.readCount).toBe(1);
    expect(stats.lastResult).toEqual({
      contentCount: 1,
      mimeType: "text/html+skybridge",
      hasHtml: true,
      widget: {
        domain: "https://widget.example.com",
        cspConnect: ["https://api.example.com"],
        cspResource: ["https://assets.example.com"],
        cspFrame: [],
      },
    });
  });

  it("apply_response__projects_resource_lastError_on_error_envelope", () => {
    const after = mcpDriver.apply(
      makeState({ resources: { "ui://w.html": { readCount: 1 } } }),
      mcpAction("response", {
        requestId: 1,
        method: "resources/read",
        resourceUri: "ui://w.html",
        durationMs: 3,
        error: { message: "not found" },
      }),
    );
    expect(after.resources["ui://w.html"].lastError).toEqual({
      message: "not found",
    });
    expect(after.network.errorCount).toBe(1);
  });

  it("apply_response__without_resourceUri_leaves_resources_untouched", () => {
    const before = makeState({
      resources: { "ui://w.html": { readCount: 1 } },
    });
    const after = mcpDriver.apply(
      before,
      mcpAction("response", {
        requestId: 1,
        method: "tools/list",
        durationMs: 1,
        result: { tools: [] },
      }),
    );
    expect(after.resources).toBe(before.resources);
  });

  it("apply_response__omits_widget_when_meta_absent", () => {
    const after = mcpDriver.apply(
      emptyState(),
      mcpAction("response", {
        requestId: 1,
        method: "resources/read",
        resourceUri: "ui://plain.txt",
        durationMs: 1,
        result: {
          contents: [{ uri: "ui://plain.txt", text: "just text" }],
        },
      }),
    );
    const proj = after.resources["ui://plain.txt"].lastResult!;
    expect(proj.widget).toBeUndefined();
    expect(proj.hasHtml).toBe(false);
    expect(proj.contentCount).toBe(1);
  });
});
