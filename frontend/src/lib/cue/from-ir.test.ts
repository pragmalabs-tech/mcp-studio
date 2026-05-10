import { describe, expect, it } from "vitest";
import { irToCue } from "./from-ir";
import type { Recorded } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";

function rec(action: Recorded): Recorded {
  return action;
}

describe("irToCue", () => {
  it("collapses mcp.request + mcp.response into mcp.call", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "user",
          method: "tools/call",
          params: { name: "x" },
        }),
        rec({
          relMs: 5,
          kind: KIND.MCP_RESPONSE,
          requestId: 1,
          result: {
            content: [{ type: "text", text: "ok" }],
            structuredContent: { temperature: 21 },
            isError: false,
          },
          durationMs: 4,
        }),
      ],
    });
    expect(cue.steps).toHaveLength(1);
    expect(cue.steps[0].kind).toBe("mcp.call");
    if (cue.steps[0].kind === "mcp.call") {
      expect(cue.steps[0].method).toBe("tools/call");
      // Type-shaped lift, not value-locked.
      const expect_ = cue.steps[0].expect as Record<string, unknown>;
      expect(expect_["result.content"]).toEqual({ type: "array" });
      expect(expect_["result.content[*].type"]).toEqual({ type: "string" });
      expect(expect_["result.structuredContent"]).toEqual({ type: "object" });
      expect(expect_["result.isError"]).toEqual({ not: true });
    }
  });

  it("lifts resources/read shape (`contents` plural per spec)", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "user",
          method: "resources/read",
          params: { uri: "ui://x" },
        }),
        rec({
          relMs: 1,
          kind: KIND.MCP_RESPONSE,
          requestId: 1,
          result: {
            contents: [{ uri: "ui://x", mimeType: "text/html", text: "..." }],
          },
          durationMs: 1,
        }),
      ],
    });
    if (cue.steps[0].kind === "mcp.call") {
      const expect_ = cue.steps[0].expect as Record<string, unknown>;
      expect(expect_["result.contents"]).toEqual({ type: "array" });
      expect(expect_["result.contents[*].uri"]).toEqual({ type: "string" });
      expect(expect_["result.contents[*].mimeType"]).toEqual({
        type: "string",
      });
      // Crucially, no "result.content" (singular tools/call key).
      expect(expect_["result.content"]).toBeUndefined();
    }
  });

  it("lifts prompts/get shape (`messages` per spec)", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "user",
          method: "prompts/get",
          params: { name: "code_review" },
        }),
        rec({
          relMs: 1,
          kind: KIND.MCP_RESPONSE,
          requestId: 1,
          result: {
            description: "x",
            messages: [{ role: "user", content: { type: "text", text: "hi" } }],
          },
          durationMs: 1,
        }),
      ],
    });
    if (cue.steps[0].kind === "mcp.call") {
      const expect_ = cue.steps[0].expect as Record<string, unknown>;
      expect(expect_["result.messages"]).toEqual({ type: "array" });
      expect(expect_["result.messages[*].role"]).toEqual({ type: "string" });
    }
  });

  it("collapses tools/call (with widget ref) + resources/read into widget.open", () => {
    const widgetUri = "ui://weather-app/index.html";
    const widgetHtml = "<!DOCTYPE html><html><body>weather</body></html>";
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "user",
          method: "tools/call",
          params: { name: "get_weather", arguments: { city: "Tokyo" } },
        }),
        rec({
          relMs: 5,
          kind: KIND.MCP_RESPONSE,
          requestId: 1,
          result: {
            content: [{ type: "text", text: "{}" }],
            structuredContent: { temp: 22 },
            _meta: { "openai/outputTemplate": widgetUri },
          },
          durationMs: 4,
        }),
        rec({
          relMs: 6,
          kind: KIND.MCP_REQUEST,
          id: 2,
          source: "user",
          method: "resources/read",
          params: { uri: widgetUri },
        }),
        rec({
          relMs: 8,
          kind: KIND.MCP_RESPONSE,
          requestId: 2,
          result: {
            contents: [
              { uri: widgetUri, mimeType: "text/html", text: widgetHtml },
            ],
          },
          durationMs: 2,
        }),
      ],
    });
    // Two steps: widget.open + widget.expect with html_drift_warn.
    expect(cue.steps).toHaveLength(2);
    expect(cue.steps[0].kind).toBe("widget.open");
    if (cue.steps[0].kind === "widget.open") {
      expect(cue.steps[0].tool).toBe("get_weather");
      expect(cue.steps[0].args).toEqual({ city: "Tokyo" });
    }
    expect(cue.steps[1].kind).toBe("widget.expect");
    if (cue.steps[1].kind === "widget.expect") {
      const entries = Array.isArray(cue.steps[1].expect)
        ? cue.steps[1].expect
        : [cue.steps[1].expect];
      const drift = entries.find((e) => e.kind === "html_drift_warn");
      expect(drift).toBeDefined();
      if (drift && drift.kind === "html_drift_warn") {
        expect(drift.recorded_html).toBe(widgetHtml);
      }
    }
  });

  it("supports Claude widget meta (ui.resourceUri)", () => {
    const widgetUri = "ui://app/index.html";
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "user",
          method: "tools/call",
          params: { name: "x" },
        }),
        rec({
          relMs: 1,
          kind: KIND.MCP_RESPONSE,
          requestId: 1,
          result: {
            content: [{ type: "text", text: "{}" }],
            _meta: { ui: { resourceUri: widgetUri } },
          },
          durationMs: 1,
        }),
        rec({
          relMs: 2,
          kind: KIND.MCP_REQUEST,
          id: 2,
          source: "user",
          method: "resources/read",
          params: { uri: widgetUri },
        }),
        rec({
          relMs: 3,
          kind: KIND.MCP_RESPONSE,
          requestId: 2,
          result: { contents: [{ uri: widgetUri, text: "hi" }] },
          durationMs: 1,
        }),
      ],
    });
    expect(cue.steps[0].kind).toBe("widget.open");
  });

  it("falls back to plain mcp.call when tools/call has no widget ref", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "user",
          method: "tools/call",
          params: { name: "x" },
        }),
        rec({
          relMs: 1,
          kind: KIND.MCP_RESPONSE,
          requestId: 1,
          // No _meta.openai/outputTemplate or ui.* — plain tool call.
          result: { content: [{ type: "text", text: "ok" }] },
          durationMs: 1,
        }),
      ],
    });
    expect(cue.steps).toHaveLength(1);
    expect(cue.steps[0].kind).toBe("mcp.call");
  });

  it("unknown method drops the implicit lift", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "user",
          method: "custom/method",
          params: {},
        }),
        rec({
          relMs: 1,
          kind: KIND.MCP_RESPONSE,
          requestId: 1,
          result: { whatever: 1 },
          durationMs: 1,
        }),
      ],
    });
    if (cue.steps[0].kind === "mcp.call") {
      expect(cue.steps[0].expect).toBeUndefined();
    }
  });

  it("emits mcp.notify when no response found", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "user",
          method: "notifications/initialized",
          params: {},
        }),
      ],
    });
    expect(cue.steps[0].kind).toBe("mcp.notify");
  });

  it("drops widget-source mcp.request", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.MCP_REQUEST,
          id: 1,
          source: "widget",
          method: "tools/call",
          params: { name: "x" },
        }),
      ],
    });
    // Falls through to "(empty recording)" placeholder
    expect(cue.steps).toHaveLength(1);
    expect(cue.steps[0].kind).toBe("flow.comment");
  });

  it("collapses widget.dom.input + widget.dom.change into widget.fill", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.WIDGET_DOM_INPUT,
          selectors: { testid: "city-input" },
          value: "Tokyo",
          inputType: "insertText",
        }),
        rec({
          relMs: 1,
          kind: KIND.WIDGET_DOM_CHANGE,
          selectors: { testid: "city-input" },
          value: "Tokyo",
        }),
      ],
    });
    expect(cue.steps).toHaveLength(1);
    expect(cue.steps[0].kind).toBe("widget.fill");
    if (cue.steps[0].kind === "widget.fill") {
      expect(cue.steps[0].value).toBe("Tokyo");
    }
  });

  it("emits widget.click for widget.dom.click", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.WIDGET_DOM_CLICK,
          selectors: { aria: { role: "button", label: "Refresh" } },
          mutated: true,
        }),
      ],
    });
    expect(cue.steps[0].kind).toBe("widget.click");
    if (cue.steps[0].kind === "widget.click") {
      expect(cue.steps[0].target).toEqual({ role: "button", name: "Refresh" });
    }
  });

  it("drops synthetic events (widget.render, csp.violation, etc.)", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.WIDGET_RENDER,
          name: "x",
          htmlHash: "h",
          initialMock: null,
        }),
        rec({
          relMs: 1,
          kind: KIND.WIDGET_RENDER_COMPLETE,
          bodyChars: 10,
          hasRuntimeErrors: false,
          handshakeOk: true,
          renderDurationMs: 5,
        }),
        rec({
          relMs: 2,
          kind: KIND.CSP_VIOLATION,
          directive: "script-src",
          blockedUri: "x",
          severity: "high",
        }),
      ],
    });
    // All synthetic — falls through to placeholder
    expect(cue.steps[0].kind).toBe("flow.comment");
  });

  it("uses chain locator when multiple selectors recorded", () => {
    const cue = irToCue({
      name: "demo",
      timeline: [
        rec({
          relMs: 0,
          kind: KIND.WIDGET_DOM_CLICK,
          selectors: {
            testid: "x",
            aria: { role: "button", label: "Y" },
          },
          mutated: true,
        }),
      ],
    });
    if (cue.steps[0].kind === "widget.click") {
      const target = cue.steps[0].target;
      if ("chain" in target) {
        expect(target.chain.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
