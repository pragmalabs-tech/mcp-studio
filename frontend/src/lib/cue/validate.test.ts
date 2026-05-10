import { describe, expect, it } from "vitest";
import { validateCue } from "./validate";

const minimalCue = {
  id: "test-id",
  name: "smoke",
  steps: [{ kind: "mcp.call", method: "tools/list" }],
};

describe("validateCue: envelope", () => {
  it("accepts a minimal valid Cue", () => {
    const r = validateCue(minimalCue);
    expect(r.ok).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validateCue("nope").ok).toBe(false);
    expect(validateCue([1]).ok).toBe(false);
  });

  it("rejects missing id", () => {
    const r = validateCue({ ...minimalCue, id: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].path).toBe("/id");
  });

  it("rejects missing name", () => {
    const { name: _n, ...rest } = minimalCue;
    const r = validateCue(rest);
    expect(r.ok).toBe(false);
  });

  it("rejects empty steps array", () => {
    const r = validateCue({ ...minimalCue, steps: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const r = validateCue({ ...minimalCue, oops: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain("oops");
  });
});

describe("validateCue: steps", () => {
  it("rejects unknown step kind", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "wat" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].path).toBe("/steps/0/kind");
  });

  it("validates mcp.call requires method", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "mcp.call" }],
    });
    expect(r.ok).toBe(false);
  });

  it("validates mcp.call expect uses paths", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "mcp.call",
          method: "tools/call",
          expect: { "result.content[0].type": "text" },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects mcp.call expect with malformed path", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "mcp.call",
          method: "tools/call",
          expect: { "result..oops": "x" },
        },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("validates mcp.expect type field", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "mcp.expect", type: "wrong", method: "x" }],
    });
    expect(r.ok).toBe(false);
  });

  it("validates widget.open requires tool", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "widget.open" }],
    });
    expect(r.ok).toBe(false);
  });

  it("validates widget.click requires target", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "widget.click" }],
    });
    expect(r.ok).toBe(false);
  });

  it("validates widget.fill requires target + value", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "widget.fill", target: { text: "x" } }],
    });
    expect(r.ok).toBe(false);
  });

  it("validates widget.wait_for condition.type", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "widget.wait_for",
          condition: { type: "weird" },
        },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("validates widget.expect requires text matcher key", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "widget.expect",
          expect: [{ kind: "text" }],
        },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts widget.expect with array", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "widget.expect",
          expect: [
            { kind: "no_runtime_errors" },
            { kind: "text", contains: "Tokyo" },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("validates assert.tool_response requires expect", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "assert.tool_response" }],
    });
    expect(r.ok).toBe(false);
  });

  it("validates flow.wait ms is non-negative", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "flow.wait", ms: -1 }],
    });
    expect(r.ok).toBe(false);
  });

  it("validates flow.comment text", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "flow.comment", text: 42 }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateCue: locators", () => {
  it("accepts simple text locator", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "widget.click", target: { text: "Submit" } }],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts role+name locator", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "widget.click",
          target: { role: "button", name: "Refresh" },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts chain locator", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "widget.click",
          target: {
            chain: [{ testid: "x" }, { role: "button", name: "X" }],
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects locator with no recognized keys", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [{ kind: "widget.click", target: { wrong: "x" } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateCue: bind", () => {
  it("validates bind paths", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "mcp.call",
          method: "tools/call",
          bind: { x: "result.foo" },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects malformed bind path", () => {
    const r = validateCue({
      ...minimalCue,
      steps: [
        {
          kind: "mcp.call",
          method: "tools/call",
          bind: { x: "result..oops" },
        },
      ],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateCue: setup", () => {
  it("accepts requires.tools", () => {
    const r = validateCue({
      ...minimalCue,
      setup: { requires: { tools: ["a", "b"] } },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects requires.tools with non-string element", () => {
    const r = validateCue({
      ...minimalCue,
      setup: { requires: { tools: ["a", 1] } },
    });
    expect(r.ok).toBe(false);
  });
});
