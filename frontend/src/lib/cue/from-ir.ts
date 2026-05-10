/**
 * Engine IR → Cue transform. Used by the recorder save path: a captured
 * `Recorded[]` is collapsed into a Cue per spec §16, then written to disk
 * as the on-wire format.
 *
 * Transform rules (best-effort):
 *  - `mcp.request` (source=user) + matching `mcp.response` → `mcp.call`
 *    with `expect.shape: <result subset>`.
 *  - `mcp.request` (source=user) without a response → `mcp.notify`.
 *  - `widget.dom.input` + `widget.dom.change` for the same target →
 *    `widget.fill`.
 *  - `widget.dom.click` → `widget.click`.
 *  - `widget.render` and `widget.render.complete` are dropped (synthetic;
 *    implied by the action that triggered them).
 *  - `mcp.request` (source=widget) is dropped — the widget reproduces it.
 *  - `csp.violation` is dropped in v1.
 *  - Anything else passes through as a `flow.comment` placeholder so the
 *    user sees what the recording captured.
 */

import type { Cue, CueStep, Locator } from "./schema";
import type { Recorded, SelectorChain } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface FromIrInput {
  name: string;
  description?: string;
  profileId?: string;
  timeline: Recorded[];
}

export function irToCue(input: FromIrInput): Cue {
  const steps: CueStep[] = [];
  const t = input.timeline;
  const consumed = new Set<number>();

  for (let i = 0; i < t.length; i++) {
    if (consumed.has(i)) continue;
    const a = t[i];

    if (a.kind === KIND.MCP_REQUEST) {
      if (a.source === "widget") {
        consumed.add(i);
        continue;
      }
      const responseIdx = findResponse(t, a.id, i);
      if (responseIdx === -1) {
        steps.push({
          kind: "mcp.notify",
          method: a.method,
          params: a.params ?? undefined,
        });
      } else {
        const resp = t[responseIdx];
        const expect =
          resp.kind === KIND.MCP_RESPONSE
            ? liftMethodAwareExpect(a.method, resp)
            : null;
        const step: CueStep = {
          kind: "mcp.call",
          method: a.method,
        };
        if (a.params !== undefined) {
          (step as { params?: unknown }).params = a.params;
        }
        if (expect && Object.keys(expect).length > 0) {
          (step as { expect?: unknown }).expect = expect;
        }
        steps.push(step);
        consumed.add(responseIdx);
      }
      consumed.add(i);
      continue;
    }

    if (a.kind === KIND.WIDGET_DOM_INPUT) {
      const pairIdx = findPairedChange(t, a, i);
      if (pairIdx !== -1) {
        steps.push({
          kind: "widget.fill",
          target: selectorChainToLocator(a.selectors),
          value: a.value,
        });
        consumed.add(pairIdx);
      } else {
        steps.push({
          kind: "widget.fill",
          target: selectorChainToLocator(a.selectors),
          value: a.value,
        });
      }
      consumed.add(i);
      continue;
    }

    if (a.kind === KIND.WIDGET_DOM_CLICK) {
      steps.push({
        kind: "widget.click",
        target: selectorChainToLocator(a.selectors),
      });
      consumed.add(i);
      continue;
    }

    if (
      a.kind === KIND.WIDGET_RENDER ||
      a.kind === KIND.WIDGET_RENDER_COMPLETE ||
      a.kind === KIND.MCP_RESPONSE ||
      a.kind === KIND.MCP_NOTIFICATION ||
      a.kind === KIND.WIDGET_INTENT ||
      a.kind === KIND.CSP_VIOLATION
    ) {
      consumed.add(i);
      continue;
    }

    if (a.kind === KIND.SIDEBAR_SELECT) {
      // Not directly representable in Cue; surface as a comment so the
      // user can see what was captured and rewrite if needed.
      steps.push({
        kind: "flow.comment",
        text: `recorder: sidebar.select ${a.selection.type} "${a.selection.name}"`,
      });
      consumed.add(i);
      continue;
    }

    if (a.kind === KIND.EDITOR_SET_ARGS) {
      steps.push({
        kind: "flow.comment",
        text: `recorder: editor.set_args ${JSON.stringify(a.value).slice(0, 60)}`,
      });
      consumed.add(i);
      continue;
    }

    // Generic catch-all: surface anything we don't know about.
    steps.push({
      kind: "flow.comment",
      text: `recorder: unhandled ${a.kind}`,
    });
    consumed.add(i);
  }

  if (steps.length === 0) {
    steps.push({
      kind: "flow.comment",
      text: "(empty recording)",
    });
  }

  return {
    id: uuid(),
    name: input.name,
    description: input.description,
    steps,
  };
}

function findResponse(t: Recorded[], requestId: number, from: number): number {
  for (let j = from + 1; j < t.length; j++) {
    const e = t[j];
    if (e.kind === KIND.MCP_RESPONSE && e.requestId === requestId) {
      return j;
    }
  }
  return -1;
}

function findPairedChange(
  t: Recorded[],
  input: Extract<Recorded, { kind: typeof KIND.WIDGET_DOM_INPUT }>,
  from: number,
): number {
  // Look ahead a few entries for a matching change with the same selectors
  // and final value. Recorder typically emits change immediately after the
  // last input.
  for (let j = from + 1; j < Math.min(t.length, from + 5); j++) {
    const e = t[j];
    if (e.kind !== KIND.WIDGET_DOM_CHANGE) continue;
    if (selectorChainEqual(e.selectors, input.selectors)) return j;
  }
  return -1;
}

function selectorChainEqual(a: SelectorChain, b: SelectorChain): boolean {
  if (a.testid !== b.testid) return false;
  if (a.css !== b.css) return false;
  if ((a.aria?.role ?? "") !== (b.aria?.role ?? "")) return false;
  if ((a.aria?.label ?? "") !== (b.aria?.label ?? "")) return false;
  return true;
}

/**
 * Lift a recorded mcp.response into a method-aware expect block. Per MCP
 * spec, response shapes are method-specific: `tools/call` has `content`
 * + `structuredContent`; `resources/read` has `contents`; `prompts/get` has
 * `messages`; etc. Lifting type-and-key claims (not recorded values) keeps
 * generated Cues robust against value drift.
 *
 * Spec references:
 * - tools/call:           https://modelcontextprotocol.io/specification/2025-06-18/server/tools#calling-tools
 * - tools/list:           same page, "Listing Tools"
 * - resources/read:       https://modelcontextprotocol.io/specification/2025-06-18/server/resources#reading-resources
 * - resources/list:       same page, "Listing Resources"
 * - resources/templates:  same page, "Resource Templates"
 * - prompts/get / list:   https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
 */
function liftMethodAwareExpect(
  method: string,
  resp: Extract<Recorded, { kind: typeof KIND.MCP_RESPONSE }>,
): Record<string, unknown> | null {
  if (resp.error) return null;
  if (resp.result === undefined || resp.result === null) return null;
  const r = resp.result as Record<string, unknown>;
  switch (method) {
    case "tools/call":
      return liftToolsCall(r);
    case "tools/list":
      return liftToolsList();
    case "resources/read":
      return liftResourcesRead(r);
    case "resources/list":
      return liftResourcesList();
    case "resources/templates/list":
      return liftResourcesTemplatesList();
    case "prompts/get":
      return liftPromptsGet();
    case "prompts/list":
      return liftPromptsList();
    case "completion/complete":
      return liftCompletion();
    case "ping":
      return null;
    default:
      // Unknown method: don't lift an implicit shape. The recording's
      // success was the only signal we had.
      return null;
  }
}

function liftToolsCall(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "result.content": { type: "array" },
  };
  if (Array.isArray(r.content) && r.content.length > 0) {
    out["result.content[*].type"] = { type: "string" };
  }
  if (r.structuredContent !== undefined) {
    out["result.structuredContent"] = { type: "object" };
  }
  if (r.isError === false) {
    out["result.isError"] = { not: true };
  }
  return out;
}

function liftToolsList(): Record<string, unknown> {
  return {
    "result.tools": { type: "array" },
    "result.tools[*].name": { type: "string" },
  };
}

function liftResourcesRead(
  r: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "result.contents": { type: "array" },
  };
  if (Array.isArray(r.contents) && r.contents.length > 0) {
    out["result.contents[*].uri"] = { type: "string" };
    const first = r.contents[0] as Record<string, unknown> | undefined;
    if (first && typeof first.mimeType === "string") {
      out["result.contents[*].mimeType"] = { type: "string" };
    }
  }
  return out;
}

function liftResourcesList(): Record<string, unknown> {
  return {
    "result.resources": { type: "array" },
    "result.resources[*].uri": { type: "string" },
  };
}

function liftResourcesTemplatesList(): Record<string, unknown> {
  return {
    "result.resourceTemplates": { type: "array" },
    "result.resourceTemplates[*].uriTemplate": { type: "string" },
  };
}

function liftPromptsGet(): Record<string, unknown> {
  return {
    "result.messages": { type: "array" },
    "result.messages[*].role": { type: "string" },
  };
}

function liftPromptsList(): Record<string, unknown> {
  return {
    "result.prompts": { type: "array" },
    "result.prompts[*].name": { type: "string" },
  };
}

function liftCompletion(): Record<string, unknown> {
  return {
    "result.completion": { type: "object" },
    "result.completion.values": { type: "array" },
  };
}

function selectorChainToLocator(chain: SelectorChain): Locator {
  // Prefer testid > role+name > text > css. Emit a chain when we have
  // multiple options so replay has fallbacks.
  const parts: Locator[] = [];
  if (chain.testid) parts.push({ testid: chain.testid });
  if (chain.aria?.role) {
    const part: Locator = { role: chain.aria.role };
    if (chain.aria.label) (part as { name?: string }).name = chain.aria.label;
    parts.push(part);
  } else if (chain.aria?.label) {
    parts.push({ label: chain.aria.label });
  }
  if (chain.text) parts.push({ text: chain.text.value });
  if (chain.css) parts.push({ css: chain.css });
  if (parts.length === 0) {
    return { css: "*" };
  }
  if (parts.length === 1) return parts[0];
  return { chain: parts };
}
