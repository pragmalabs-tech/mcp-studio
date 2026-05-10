/**
 * TypeScript shape of a Cue file. Mirrors the spec at
 * `mcp-studio/docs/cue-spec.md` exactly. Discriminated unions on `kind`
 * (steps), and on the inner shape (Locator, Matcher, WidgetExpect) so
 * callers narrow.
 *
 * `Matcher` is intentionally typed as `unknown` because the matcher
 * language is too dynamic for useful TS narrowing; the validator and
 * `match.ts` evaluator do runtime checking instead.
 */

// ── Locator ─────────────────────────────────────────────────────────────────

export type Locator =
  | { text: string; exact?: boolean }
  | { role: string; name?: string | { matches: string } }
  | { label: string }
  | { placeholder: string }
  | { testid: string }
  | { alt: string }
  | { title: string }
  | { css: string }
  | { chain: Locator[] };

// ── Matcher language ────────────────────────────────────────────────────────

/**
 * Any JSON value. Literals (string/number/bool/null/array) compare by
 * deep equality; objects with known matcher keys are evaluated by
 * `runMatcher` in `match.ts`.
 */
export type Matcher = unknown;

/**
 * Path-keyed expect block: keys are dot-paths, values are matchers.
 * See spec §8.
 */
export type ExpectBlock = Record<string, Matcher>;

// ── Bind ────────────────────────────────────────────────────────────────────

export type BindMap = Record<string, string>; // var name → path

// ── MCP namespace ───────────────────────────────────────────────────────────

export interface McpCall {
  kind: "mcp.call";
  method: string;
  params?: unknown;
  expect?: ExpectBlock;
  bind?: BindMap;
  timeout_ms?: number;
}

export interface McpNotify {
  kind: "mcp.notify";
  method: string;
  params?: unknown;
}

export interface McpExpect {
  kind: "mcp.expect";
  type: "request" | "notification";
  method: string;
  match?: ExpectBlock;
  respond?: unknown;
  timeout_ms?: number;
  bind?: BindMap;
}

// ── Widget namespace ────────────────────────────────────────────────────────

export interface WidgetOpen {
  kind: "widget.open";
  tool: string;
  args?: unknown;
  expect?: ExpectBlock;
  bind?: BindMap;
}

export interface WidgetClick {
  kind: "widget.click";
  target: Locator;
  expect?: WidgetExpectStep["expect"];
}

export interface WidgetFill {
  kind: "widget.fill";
  target: Locator;
  value: string;
}

export interface WidgetWaitFor {
  kind: "widget.wait_for";
  target?: Locator;
  condition: WaitCondition;
  timeout_ms?: number;
}

export type WaitCondition =
  | { type: "visible" }
  | { type: "hidden" }
  | { type: "text"; value: string | { matches: string } }
  | { type: "count"; value: number | Matcher };

export interface WidgetExpectStep {
  kind: "widget.expect";
  expect: WidgetExpectEntry | WidgetExpectEntry[];
}

export type WidgetExpectEntry =
  | {
      kind: "text";
      target?: Locator;
      equals?: string;
      contains?: string;
      matches?: string;
    }
  | { kind: "visible"; target: Locator }
  | { kind: "no_runtime_errors" }
  | { kind: "no_csp_violations"; since?: "cue_start" | "last_action" }
  | {
      kind: "triggers_mcp_call";
      method: string;
      match?: ExpectBlock;
      within_ms?: number;
    }
  | {
      // Compares the rendered widget's HTML against a snapshot captured at
      // record time. Soft-only: differences surface in the report as a
      // warning rather than failing the step. Useful drift signal without
      // forcing test churn on every cosmetic widget change.
      kind: "html_drift_warn";
      recorded_html: string;
      // Tolerance: pct length difference before warning fires. Default 5%.
      tolerance_pct?: number;
    };

// ── Assert namespace ────────────────────────────────────────────────────────

export interface AssertToolResponse {
  kind: "assert.tool_response";
  method?: string;
  match_params?: ExpectBlock;
  expect: ExpectBlock;
}

// ── Flow namespace ──────────────────────────────────────────────────────────

export interface FlowWait {
  kind: "flow.wait";
  ms: number;
}

export interface FlowComment {
  kind: "flow.comment";
  text: string;
}

// ── Step union ──────────────────────────────────────────────────────────────

export type CueStep =
  | McpCall
  | McpNotify
  | McpExpect
  | WidgetOpen
  | WidgetClick
  | WidgetFill
  | WidgetWaitFor
  | WidgetExpectStep
  | AssertToolResponse
  | FlowWait
  | FlowComment;

export type CueStepKind = CueStep["kind"];

export const CUE_STEP_KINDS: ReadonlyArray<CueStepKind> = [
  "mcp.call",
  "mcp.notify",
  "mcp.expect",
  "widget.open",
  "widget.click",
  "widget.fill",
  "widget.wait_for",
  "widget.expect",
  "assert.tool_response",
  "flow.wait",
  "flow.comment",
];

// ── Envelope ────────────────────────────────────────────────────────────────

export interface CueSetup {
  profile?: string;
  requires?: {
    tools?: string[];
    resources?: string[];
  };
}

export interface Cue {
  id: string;
  name: string;
  description?: string;
  setup?: CueSetup;
  fixtures?: Record<string, unknown>;
  steps: CueStep[];
}
