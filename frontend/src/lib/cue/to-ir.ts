/**
 * Cue → Engine IR translator. Each Cue step becomes one or more `Recorded`
 * actions, with implicit + explicit assertions attached as `_cue` bundles
 * for the engine's post-driver assertion runner.
 *
 * Output shape is the existing `Test` envelope so `engine.run()` consumes
 * Cues with no API change. The translator owns all impedance between the
 * declarative Cue and the imperative IR.
 */

import type {
  AssertToolResponse,
  Cue,
  CueStep,
  ExpectBlock,
  FlowComment,
  FlowWait,
  Locator,
  McpCall,
  McpExpect,
  McpNotify,
  WaitCondition,
  WidgetClick,
  WidgetExpectEntry,
  WidgetExpectStep,
  WidgetFill,
  WidgetOpen,
  WidgetWaitFor,
} from "./schema";
import type { CueAssertion, CueAssertionBundle } from "./assertions";
import type { Recorded, Test, SelectorChain } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";
import { timeoutFor } from "@/lib/engine/timing";

const STUDIO_VERSION = "cue-v1";

/** Stable counter for synthesized request ids inside one translation. */
class IdGen {
  private n = 1;
  next(): number {
    return this.n++;
  }
}

export function cueToIr(cue: Cue): Test {
  const ids = new IdGen();
  const timeline: Recorded[] = [];
  for (const step of cue.steps) {
    for (const action of translateStep(step, ids)) {
      timeline.push(action);
    }
  }

  return {
    id: cue.id,
    name: cue.name,
    description: cue.description,
    createdAt: new Date().toISOString(),
    profileId: undefined,
    session: {
      version: 1,
      capturedAt: new Date().toISOString(),
      studioVersion: STUDIO_VERSION,
      setup: defaultSetup(),
      timeline,
    },
  };
}

function translateStep(step: CueStep, ids: IdGen): Recorded[] {
  switch (step.kind) {
    case "mcp.call":
      return translateMcpCall(step, ids);
    case "mcp.notify":
      return translateMcpNotify(step);
    case "mcp.expect":
      return translateMcpExpect(step);
    case "widget.open":
      return translateWidgetOpen(step, ids);
    case "widget.click":
      return translateWidgetClick(step);
    case "widget.fill":
      return translateWidgetFill(step);
    case "widget.wait_for":
      return translateWidgetWaitFor(step);
    case "widget.expect":
      return translateWidgetExpect(step);
    case "assert.tool_response":
      return translateAssertToolResponse(step);
    case "flow.wait":
      return translateFlowWait(step);
    case "flow.comment":
      return translateFlowComment(step);
  }
}

// ── mcp.* ──────────────────────────────────────────────────────────────────

function translateMcpCall(step: McpCall, ids: IdGen): Recorded[] {
  const id = ids.next();
  const post: CueAssertion[] = [];
  // `isError` is defined only on `CallToolResult` per MCP spec. Other
  // methods report failures via JSON-RPC envelope errors which mcpCall
  // already throws (and the driver surfaces as a fail outcome).
  if (step.method === "tools/call") {
    post.push({
      kind: "result_match",
      expect: { "result.isError": { not: true } },
    });
  }
  if (step.expect) {
    post.push({ kind: "result_match", expect: step.expect });
  }
  return [
    {
      relMs: 0,
      kind: KIND.MCP_REQUEST,
      id,
      source: "user",
      method: step.method,
      params: step.params ?? {},
      _cue: {
        label: `mcp.call ${step.method}`,
        post,
      } satisfies CueAssertionBundle,
    },
  ];
}

function translateMcpNotify(step: McpNotify): Recorded[] {
  return [
    {
      relMs: 0,
      kind: KIND.CUE_NOTIFY,
      method: step.method,
      params: step.params,
    },
  ];
}

function translateMcpExpect(step: McpExpect): Recorded[] {
  const post: CueAssertion[] = [];
  if (step.match) {
    post.push({ kind: "result_match", expect: step.match });
  }
  return [
    {
      relMs: 0,
      kind: KIND.CUE_EXPECT_INBOUND,
      type: step.type,
      method: step.method,
      timeoutMs: step.timeout_ms ?? timeoutFor(KIND.CUE_EXPECT_INBOUND),
      _cue: {
        label: `mcp.expect ${step.method}`,
        post,
      },
    },
  ];
}

// ── widget.* ───────────────────────────────────────────────────────────────

function translateWidgetOpen(step: WidgetOpen, _ids: IdGen): Recorded[] {
  const post: CueAssertion[] = [
    {
      kind: "result_match",
      expect: { "result.isError": { not: true } },
    },
    // Implicit: response declares a widget. Per the OpenAI Apps SDK
    // convention, the widget reference lives at `_meta.openai/outputTemplate`.
    // Authors can override with their own `expect`.
    {
      kind: "result_match",
      expect: { "result._meta.openai/outputTemplate": { exists: true } },
    },
    // Render-success implicits. The cueDriver's cue.widget_open returns
    // observation = { result, render: RenderCompleteResult | null }, so
    // these path-keyed expects walk into the render payload directly.
    // - render.bodyChars > 0  → widget mounted with non-empty body
    // - render.handshakeOk    → ext-apps init handshake completed
    // - render.hasRuntimeErrors !== true  → no window.onerror during init
    // If render is null (timeout / never fired), every path resolves to
    // nothing and the bundle fails with a clear "path resolved to nothing"
    // for the first check — pinpointing "render did not fire".
    {
      kind: "result_match",
      expect: {
        "render.bodyChars": { gte: 1 },
        "render.handshakeOk": true,
        "render.hasRuntimeErrors": { not: true },
      },
    },
    { kind: "no_runtime_errors" },
  ];
  if (step.expect) {
    post.splice(1, 0, { kind: "result_match", expect: step.expect });
  }

  return [
    {
      relMs: 0,
      kind: KIND.CUE_WIDGET_OPEN,
      tool: step.tool,
      args: step.args ?? {},
      _cue: {
        label: `widget.open ${step.tool}`,
        post,
      },
    },
  ];
}

function translateWidgetClick(step: WidgetClick): Recorded[] {
  const post: CueAssertion[] = [];
  if (step.expect) {
    for (const e of arrayOf(step.expect)) {
      const a = widgetExpectToAssertion(e);
      if (a) post.push(a);
    }
  }
  return [
    {
      relMs: 0,
      kind: KIND.WIDGET_DOM_CLICK,
      selectors: locatorToSelectorChain(step.target),
      mutated: false,
      _cue: {
        label: `widget.click ${describeLocator(step.target)}`,
        post,
      },
    },
  ];
}

function translateWidgetFill(step: WidgetFill): Recorded[] {
  const selectors = locatorToSelectorChain(step.target);
  return [
    {
      relMs: 0,
      kind: KIND.WIDGET_DOM_INPUT,
      selectors,
      value: step.value,
      inputType: "insertText",
    },
    {
      relMs: 0,
      kind: KIND.WIDGET_DOM_CHANGE,
      selectors,
      value: step.value,
      _cue: {
        label: `widget.fill ${describeLocator(step.target)}`,
        post: [
          {
            kind: "dom_text",
            target: step.target,
            // Implicit reflection check: input's text content / value contains
            // the typed value. DOM query reads `value` for inputs via a
            // best-effort check.
            contains: step.value,
          },
        ],
      },
    },
  ];
}

function translateWidgetWaitFor(step: WidgetWaitFor): Recorded[] {
  const condition: WaitCondition = step.condition;
  const timeoutMs = step.timeout_ms ?? 5_000;
  return [
    {
      relMs: 0,
      kind: KIND.CUE_ASSERT,
      label: `wait_for ${condition.type}`,
      _cue: {
        label: `widget.wait_for ${condition.type}`,
        post: [
          {
            kind: "dom_wait",
            target: step.target,
            condition,
            timeoutMs,
          },
        ],
      },
    },
  ];
}

function translateWidgetExpect(step: WidgetExpectStep): Recorded[] {
  const entries = arrayOf(step.expect);
  const post: CueAssertion[] = [];
  for (const e of entries) {
    const a = widgetExpectToAssertion(e);
    if (a) post.push(a);
  }
  return [
    {
      relMs: 0,
      kind: KIND.CUE_ASSERT,
      label: "widget.expect",
      _cue: { label: "widget.expect", post },
    },
  ];
}

function widgetExpectToAssertion(e: WidgetExpectEntry): CueAssertion | null {
  switch (e.kind) {
    case "text":
      return {
        kind: "dom_text",
        target: e.target,
        equals: e.equals,
        contains: e.contains,
        matches: e.matches,
      };
    case "visible":
      return { kind: "dom_visible", target: e.target };
    case "no_runtime_errors":
      return { kind: "no_runtime_errors" };
    case "no_csp_violations":
      return {
        kind: "no_csp_violations",
        since: e.since ?? "last_action",
      };
    case "triggers_mcp_call":
      return {
        kind: "triggers_mcp_call",
        method: e.method,
        match: e.match,
        withinMs: e.within_ms ?? 1_000,
      };
    case "html_drift_warn":
      return {
        kind: "html_drift_warn",
        recordedHtml: e.recorded_html,
        tolerancePct: e.tolerance_pct ?? 5,
      };
  }
}

// ── assert.* ───────────────────────────────────────────────────────────────

function translateAssertToolResponse(step: AssertToolResponse): Recorded[] {
  return [
    {
      relMs: 0,
      kind: KIND.CUE_ASSERT,
      label: `assert.tool_response ${step.method ?? "(any)"}`,
      _cue: {
        label: `assert.tool_response ${step.method ?? "(any)"}`,
        post: [
          {
            kind: "tool_response",
            method: step.method,
            matchParams: step.match_params,
            expect: step.expect,
          },
        ],
      },
    },
  ];
}

// ── flow.* ─────────────────────────────────────────────────────────────────

function translateFlowWait(step: FlowWait): Recorded[] {
  return [{ relMs: 0, kind: KIND.CUE_WAIT, ms: step.ms }];
}

function translateFlowComment(step: FlowComment): Recorded[] {
  return [
    {
      relMs: 0,
      kind: KIND.CUE_ASSERT,
      label: `// ${step.text}`,
      _cue: { label: `// ${step.text}`, post: [] },
    },
  ];
}

// ── locator helpers ────────────────────────────────────────────────────────

function locatorToSelectorChain(locator: Locator): SelectorChain {
  // The recorder's SelectorChain is a flat object, not a discriminated
  // union; we lift the relevant fields out of the authored Locator. When
  // the author supplied a `chain`, fold each chain member into the same
  // SelectorChain — recorder's resolveSelectorChain tries them in order.
  const chain: SelectorChain = {};
  flattenLocator(locator, chain);
  return chain;
}

function flattenLocator(locator: Locator, into: SelectorChain): void {
  if ("chain" in locator) {
    for (const sub of locator.chain) flattenLocator(sub, into);
    return;
  }
  if ("testid" in locator) {
    into.testid = locator.testid;
  } else if ("text" in locator) {
    into.text = { tag: "*", value: locator.text };
  } else if ("role" in locator) {
    const name = typeof locator.name === "string" ? locator.name : undefined;
    into.aria = { role: locator.role, label: name };
  } else if ("label" in locator) {
    into.aria = { label: locator.label };
  } else if ("placeholder" in locator) {
    into.css = `[placeholder="${cssEscape(locator.placeholder)}"]`;
  } else if ("alt" in locator) {
    into.css = `[alt="${cssEscape(locator.alt)}"]`;
  } else if ("title" in locator) {
    into.css = `[title="${cssEscape(locator.title)}"]`;
  } else if ("css" in locator) {
    into.css = locator.css;
  }
}

function cssEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}

function describeLocator(locator: Locator): string {
  if ("chain" in locator) return `chain[${locator.chain.length}]`;
  if ("text" in locator) return `text "${locator.text}"`;
  if ("role" in locator) {
    const name = typeof locator.name === "string" ? ` "${locator.name}"` : "";
    return `role ${locator.role}${name}`;
  }
  if ("testid" in locator) return `testid "${locator.testid}"`;
  if ("label" in locator) return `label "${locator.label}"`;
  if ("placeholder" in locator) return `placeholder "${locator.placeholder}"`;
  if ("alt" in locator) return `alt "${locator.alt}"`;
  if ("title" in locator) return `title "${locator.title}"`;
  if ("css" in locator) return `css ${locator.css}`;
  return "?";
}

function arrayOf<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function defaultSetup() {
  return {
    connect: {
      url: "",
      auth: { method: "oauth" as const, token: "" },
    },
    config: {
      platform: "openai" as const,
      theme: "dark",
      displayMode: "compact",
      locale: "en-US",
      viewport: { preset: "mobile" },
      strictMode: false,
    },
  };
}

// Re-export helper expected by callers.
export type { ExpectBlock };
