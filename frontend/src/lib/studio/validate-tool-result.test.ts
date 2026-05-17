import { describe, expect, it } from "vitest";
import { validateToolResult } from "./validate-tool-result";

describe("validateToolResult - structuredContent shape", () => {
  it("no structuredContent key: passes", () => {
    const issues = validateToolResult({
      content: [{ type: "text", text: "hi" }],
    });
    expect(issues).toEqual([]);
  });

  it("structuredContent is plain object: passes", () => {
    const issues = validateToolResult({
      structuredContent: { temperature: 22.5 },
    });
    expect(issues).toEqual([]);
  });

  it("structuredContent is null: error", () => {
    const issues = validateToolResult({ structuredContent: null });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("structured-content-not-object");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].detail).toContain("null");
  });

  it("structuredContent is array: error", () => {
    const issues = validateToolResult({ structuredContent: [1, 2, 3] });
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("array");
  });

  it("structuredContent is string: error", () => {
    const issues = validateToolResult({ structuredContent: "raw text" });
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("string");
  });

  it("structuredContent is number: error", () => {
    const issues = validateToolResult({ structuredContent: 42 });
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("number");
  });

  it("structuredContent is boolean: error", () => {
    const issues = validateToolResult({ structuredContent: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("boolean");
  });

  it("non-object result (string / null / undefined): no issues", () => {
    expect(validateToolResult(null)).toEqual([]);
    expect(validateToolResult(undefined)).toEqual([]);
    expect(validateToolResult("string")).toEqual([]);
  });
});
