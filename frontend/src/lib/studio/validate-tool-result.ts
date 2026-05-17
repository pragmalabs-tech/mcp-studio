/**
 * MCP spec validation for `tools/call` responses.
 *
 * Currently checks one rule: when `structuredContent` is present, it must
 * be a JSON object. The MCP 2025-06-18 spec says "Structured content is
 * returned as a JSON object in the structuredContent field of a result"
 * and both Claude and ChatGPT will try to JSON.parse / pattern-match it
 * as an object, so primitives, arrays, and null are silent footguns -
 * they parse, then break the consumer.
 *
 * Each issue is reported as a structured record so the UI can show a
 * banner with the offending value's type alongside a fix hint.
 */

export type ResultIssueSeverity = "error" | "warn";

export interface ResultIssue {
  severity: ResultIssueSeverity;
  /** Stable key so React can render the issue list without a UUID. */
  code: string;
  /** One-line headline. */
  title: string;
  /** Sentence-long explanation of what's wrong and why it matters. */
  detail: string;
  /** Optional fix hint shown beneath the detail. */
  fix?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Validate an MCP `tools/call` result. Returns issues; empty array is
 *  the happy path. Safe to call with anything - non-object inputs return
 *  an empty list (the wrapping error surface handles those). */
export function validateToolResult(result: unknown): ResultIssue[] {
  const issues: ResultIssue[] = [];
  if (!isPlainObject(result)) return issues;

  // `structuredContent` is optional. But if the key is present, the value
  // must be a plain object - clients consume it as one.
  if ("structuredContent" in result) {
    const sc = result.structuredContent;
    if (!isPlainObject(sc)) {
      issues.push({
        severity: "error",
        code: "structured-content-not-object",
        title: "structuredContent must be a JSON object",
        detail: `Got ${describe(sc)}. The MCP spec requires structuredContent to be an object ({...}); Claude and ChatGPT parse this field as a JSON object and will break on primitives, arrays, or null.`,
        fix: 'Wrap the value: { "result": <your value> }, or omit structuredContent and return only `content[]` for unstructured payloads.',
      });
    }
  }

  return issues;
}
