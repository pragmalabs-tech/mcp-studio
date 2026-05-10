import { describe, expect, it } from "vitest";
import type { Cue } from "./schema";
import { cueToIr } from "./to-ir";
import { KIND } from "@/lib/recorder/kinds";

function cueOf(steps: Cue["steps"]): Cue {
  return { id: "t", name: "n", steps };
}

describe("cueToIr: mcp.call", () => {
  it("non-tools/call methods skip the isError implicit (per MCP spec)", () => {
    // `isError` is defined only on `CallToolResult`. For tools/list,
    // resources/read, etc. there's no implicit shape to assert.
    const test = cueToIr(cueOf([{ kind: "mcp.call", method: "tools/list" }]));
    expect(test.session.timeline).toHaveLength(1);
    const action = test.session.timeline[0];
    expect(action.kind).toBe(KIND.MCP_REQUEST);
    expect(action._cue?.post).toHaveLength(0);
  });

  it("tools/call adds the implicit isError != true check", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "mcp.call",
          method: "tools/call",
          params: { name: "x" },
        },
      ]),
    );
    const post = test.session.timeline[0]._cue!.post;
    expect(post).toHaveLength(1);
    expect(post[0].kind).toBe("result_match");
    if (post[0].kind === "result_match") {
      expect(Object.keys(post[0].expect)).toContain("result.isError");
    }
  });

  it("attaches author expect after the implicit check", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "mcp.call",
          method: "tools/call",
          params: { name: "x" },
          expect: { "result.content[0].type": "text" },
        },
      ]),
    );
    const post = test.session.timeline[0]._cue!.post;
    expect(post).toHaveLength(2);
    expect(post[1].kind).toBe("result_match");
  });
});

describe("cueToIr: widget.open", () => {
  it("emits a single cue.widget_open step (not separate request + render)", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "widget.open",
          tool: "get_weather",
          args: { city: "Tokyo" },
        },
      ]),
    );
    expect(test.session.timeline).toHaveLength(1);
    const action = test.session.timeline[0];
    expect(action.kind).toBe(KIND.CUE_WIDGET_OPEN);
    if (action.kind === KIND.CUE_WIDGET_OPEN) {
      expect(action.tool).toBe("get_weather");
      expect(action.args).toEqual({ city: "Tokyo" });
    }
  });

  it("widget.open asserts widget reference + no runtime errors", () => {
    const test = cueToIr(cueOf([{ kind: "widget.open", tool: "x" }]));
    const post = test.session.timeline[0]._cue!.post;
    const matchers = post.filter(
      (a): a is Extract<typeof a, { kind: "result_match" }> =>
        a.kind === "result_match",
    );
    const allKeys = matchers.flatMap((m) => Object.keys(m.expect));
    expect(allKeys).toContain("result._meta.openai/outputTemplate");
    expect(post.some((a) => a.kind === "no_runtime_errors")).toBe(true);
  });
});

describe("cueToIr: widget.fill", () => {
  it("collapses to input + change pair", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "widget.fill",
          target: { label: "City" },
          value: "Tokyo",
        },
      ]),
    );
    expect(test.session.timeline).toHaveLength(2);
    expect(test.session.timeline[0].kind).toBe(KIND.WIDGET_DOM_INPUT);
    expect(test.session.timeline[1].kind).toBe(KIND.WIDGET_DOM_CHANGE);
  });
});

describe("cueToIr: widget.click", () => {
  it("emits widget.dom.click with selectors derived from locator", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "widget.click",
          target: { role: "button", name: "Refresh" },
        },
      ]),
    );
    const action = test.session.timeline[0];
    expect(action.kind).toBe(KIND.WIDGET_DOM_CLICK);
    if (action.kind === KIND.WIDGET_DOM_CLICK) {
      expect(action.selectors.aria?.role).toBe("button");
      expect(action.selectors.aria?.label).toBe("Refresh");
    }
  });

  it("flattens chain locator into one SelectorChain", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "widget.click",
          target: {
            chain: [{ testid: "x" }, { role: "button", name: "Y" }],
          },
        },
      ]),
    );
    const action = test.session.timeline[0];
    if (action.kind === KIND.WIDGET_DOM_CLICK) {
      expect(action.selectors.testid).toBe("x");
      expect(action.selectors.aria?.role).toBe("button");
    }
  });
});

describe("cueToIr: widget.expect / wait_for / assert.tool_response", () => {
  it("widget.expect becomes cue.assert with bundle", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "widget.expect",
          expect: [
            { kind: "no_runtime_errors" },
            { kind: "text", contains: "Tokyo" },
          ],
        },
      ]),
    );
    expect(test.session.timeline[0].kind).toBe(KIND.CUE_ASSERT);
    expect(test.session.timeline[0]._cue?.post).toHaveLength(2);
  });

  it("widget.wait_for becomes cue.assert with dom_wait", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "widget.wait_for",
          condition: { type: "text", value: "Loaded" },
          timeout_ms: 1000,
        },
      ]),
    );
    const action = test.session.timeline[0];
    expect(action.kind).toBe(KIND.CUE_ASSERT);
    expect(action._cue?.post[0].kind).toBe("dom_wait");
  });

  it("assert.tool_response becomes cue.assert with tool_response", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "assert.tool_response",
          method: "tools/call",
          expect: { "structuredContent.x": { type: "number" } },
        },
      ]),
    );
    const action = test.session.timeline[0];
    expect(action.kind).toBe(KIND.CUE_ASSERT);
    expect(action._cue?.post[0].kind).toBe("tool_response");
  });
});

describe("cueToIr: flow.*", () => {
  it("flow.wait becomes cue.wait", () => {
    const test = cueToIr(cueOf([{ kind: "flow.wait", ms: 100 }]));
    const action = test.session.timeline[0];
    expect(action.kind).toBe(KIND.CUE_WAIT);
    if (action.kind === KIND.CUE_WAIT) expect(action.ms).toBe(100);
  });

  it("flow.comment becomes cue.assert no-op", () => {
    const test = cueToIr(cueOf([{ kind: "flow.comment", text: "hi" }]));
    const action = test.session.timeline[0];
    expect(action.kind).toBe(KIND.CUE_ASSERT);
    expect(action._cue?.post).toHaveLength(0);
  });
});

describe("cueToIr: mcp.notify / mcp.expect", () => {
  it("mcp.notify becomes cue.notify", () => {
    const test = cueToIr(
      cueOf([{ kind: "mcp.notify", method: "notifications/initialized" }]),
    );
    expect(test.session.timeline[0].kind).toBe(KIND.CUE_NOTIFY);
  });

  it("mcp.expect becomes cue.expect_inbound", () => {
    const test = cueToIr(
      cueOf([
        {
          kind: "mcp.expect",
          type: "notification",
          method: "notifications/progress",
        },
      ]),
    );
    expect(test.session.timeline[0].kind).toBe(KIND.CUE_EXPECT_INBOUND);
  });
});
