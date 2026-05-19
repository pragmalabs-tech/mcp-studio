/**
 * Pure helpers for translating a Trace step into renderable pieces:
 *   - JSON view (result/request/payload pretty-print)
 *   - active widget HTML + mock + CSP findings
 *   - viewable lookups (for content modal triggers)
 *
 * No React. Lives outside trace-modal.tsx so the right-pane components
 * (StepDetail, DriftCard) can compose these without cross-importing
 * from a UI file.
 */

import { analyze } from "@/lib/core/csp/analyze";
import { extractCspDomains } from "@/lib/core/csp/profiles";
import type { MockData } from "@/lib/studio/mock-openai";
import type { Action, Step } from "../types";

export interface JsonView {
  label: string;
  subtitle?: string;
  body: string;
}

export interface ActiveWidget {
  uri: string;
  html: string;
  mock: MockData;
  findings: ReturnType<typeof analyze>["findings"];
}

export interface Viewable {
  title: string;
  widget?: { html: string };
  raw?: unknown;
}

const LARGE_PAYLOAD_THRESHOLD = 200;

/** Build the JSON-output panel for a step. Prefers structured tool
 *  results (parsed from `content[0].text` when possible), then raw
 *  response/request payloads, with sensible labels. */
export function buildJsonView(
  steps: readonly Step[],
  selectedIdx: number,
): JsonView | null {
  const step = steps[Math.min(selectedIdx, steps.length - 1)];
  if (!step) return null;
  const a = step.action;

  if (a.driver === "mcp" && a.kind === "response") {
    const result = a.payload.result;
    const baseLabel = responseLabel(a.payload);
    const subtitle = `${a.payload.durationMs.toFixed(1)}ms`;
    const parsed = parseToolResult(result);
    if (parsed !== undefined) {
      return { label: baseLabel, subtitle, body: prettify(parsed) };
    }
    if (a.payload.error) {
      return {
        label: `${baseLabel} (error)`,
        subtitle,
        body: prettify(a.payload.error),
      };
    }
    return { label: baseLabel, subtitle, body: prettify(result ?? null) };
  }

  if (a.driver === "mcp" && a.kind === "request") {
    return {
      label: a.payload.method,
      subtitle: `id ${a.payload.id} · ${a.source}`,
      body: prettify(a.payload.params ?? {}),
    };
  }

  if (a.driver === "studio") {
    return { label: `${a.driver}.${a.kind}`, body: prettify(a.payload) };
  }

  if (a.driver === "widget") {
    return { label: `${a.driver}.${a.kind}`, body: prettify(a.payload) };
  }

  return null;
}

function responseLabel(p: {
  tool?: string;
  method?: string;
  resourceUri?: string;
}): string {
  if (p.tool) return `tools/call ${p.tool}`;
  if (p.method === "resources/read" && p.resourceUri) {
    return `resources/read ${p.resourceUri}`;
  }
  return p.method ?? "mcp.response";
}

/** Tool results land as `{ structuredContent }` or `{ content: [{ text }] }`.
 *  Lift whichever shape is present, parsing JSON text when possible. */
export function parseToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { structuredContent?: unknown; content?: unknown };
  if (r.structuredContent !== undefined) return r.structuredContent;
  if (Array.isArray(r.content)) {
    const first = r.content[0] as { text?: unknown } | undefined;
    if (typeof first?.text === "string") {
      try {
        return JSON.parse(first.text);
      } catch {
        return first.text;
      }
    }
  }
  return undefined;
}

export function prettify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function findActiveWidget(
  steps: readonly Step[],
  selectedIdx: number,
): ActiveWidget | null {
  const upper = Math.min(selectedIdx, steps.length - 1);

  // Suppress the widget pane when the selected step isn't about widget
  // delivery or interaction:
  //   - `mcp.request resources/read` — the HTML hasn't been delivered
  //     yet at this step; showing a previously-rendered widget is
  //     misleading.
  //   - `mcp.response tools/call` — the response carries the tool's
  //     JSON data, not the widget itself. Re-rendering the widget here
  //     against the new tool data has caused user confusion in review
  //     (apparent random reshuffles per click for non-deterministic
  //     widget code); the JSON pane already shows what landed.
  // Widget rendering still surfaces on `mcp.response resources/read`
  // (the actual HTML delivery), on `widget.*` steps, and on `studio.*`
  // steps where the previous render is the relevant view.
  const sel = steps[upper]?.action;
  if (sel?.driver === "mcp") {
    if (sel.kind === "request" && sel.payload.method === "resources/read")
      return null;
    if (sel.kind === "response" && sel.payload.tool) return null;
  }

  // Walk back from the selected step to find the latest MCP response that
  // carried widget HTML directly inside its result. We read the URI out of
  // `result.contents[i].uri` rather than pairing with a request, because the
  // recorder's `id` counter and the stored `requestId` don't always line up
  // (traces recorded across separate sessions / id reuse).
  let html: string | null = null;
  let uri: string | null = null;
  let meta: Record<string, unknown> = {};
  for (let i = upper; i >= 0; i--) {
    const a = steps[i].action;
    if (a.driver === "widget" && a.kind === "opened") {
      const found = findWidgetHtml(steps, a.payload.uri, i + 1);
      if (found) {
        html = found;
        uri = a.payload.uri;
        break;
      }
    }
    if (a.driver === "mcp" && a.kind === "response") {
      const hit = extractWidgetFromResponse(a.payload.result);
      if (hit) {
        html = hit.html;
        uri = hit.uri;
        meta = hit.meta;
        break;
      }
    }
  }
  if (!html || !uri) return null;

  const toolOutput = findLatestToolOutput(steps, upper);

  const studio = steps[upper]?.stateAfter.studio;
  const mock: MockData = {
    toolInput: {},
    toolOutput,
    _meta: meta,
    widgetState: null,
    theme: studio?.theme ?? "dark",
    locale: studio?.locale ?? "en-US",
    displayMode: studio?.displayMode ?? "inline",
  };
  const { findings } = analyze(html, extractCspDomains(mock._meta));
  return { uri, html, mock, findings };
}

/** Return the first HTML-looking content entry from a `resources/read`
 *  result, along with its declared URI and any `_meta` block (MCP Apps
 *  spec puts CSP domains on the content entry itself). */
export function extractWidgetFromResponse(
  result: unknown,
): { uri: string; html: string; meta: Record<string, unknown> } | null {
  const contents = (result as { contents?: unknown } | null)?.contents;
  if (!Array.isArray(contents)) return null;
  for (const c of contents) {
    if (!c || typeof c !== "object") continue;
    const entry = c as { uri?: unknown; text?: unknown; _meta?: unknown };
    const text = typeof entry.text === "string" ? entry.text : null;
    if (!text) continue;
    const u = typeof entry.uri === "string" ? entry.uri : null;
    if ((u && u.startsWith("ui://")) || looksLikeHtml(text)) {
      const m =
        entry._meta && typeof entry._meta === "object"
          ? (entry._meta as Record<string, unknown>)
          : {};
      return { uri: u ?? "(html)", html: text, meta: m };
    }
  }
  return null;
}

/** Pull the most recent `tools/call` result text payload (parsed as JSON
 *  when possible) so the replay widget can render with the same data the
 *  user saw at record time. */
export function findLatestToolOutput(
  steps: readonly Step[],
  upper: number,
): unknown {
  for (let i = upper; i >= 0; i--) {
    const a = steps[i].action;
    if (a.driver !== "mcp" || a.kind !== "response") continue;
    const result = a.payload.result as {
      content?: unknown;
      structuredContent?: unknown;
    } | null;
    if (!result) continue;
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = Array.isArray(result.content) ? result.content : null;
    if (!content) continue;
    const first = content[0] as { text?: unknown } | undefined;
    if (typeof first?.text !== "string") continue;
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }
  return {};
}

export function looksLikeHtml(s: string): boolean {
  return /<html|<!doctype|<body|<head/i.test(s.slice(0, 2000));
}

export function buildViewable(
  action: Action,
  steps: readonly Step[],
  index: number,
): Viewable | null {
  if (action.driver === "widget" && action.kind === "opened") {
    const html = findWidgetHtml(steps, action.payload.uri, index);
    if (html) return { title: action.payload.uri, widget: { html } };
    return { title: action.payload.uri, raw: action.payload.data };
  }
  const json = safeStringify(action.payload);
  if (json.length > LARGE_PAYLOAD_THRESHOLD) {
    return { title: `${action.driver}.${action.kind}`, raw: action.payload };
  }
  return null;
}

/** Walk steps before `beforeIdx` and resolve the most recent
 *  `resources/read` response whose request URI matches. */
export function findWidgetHtml(
  steps: readonly Step[],
  uri: string,
  beforeIdx: number,
): string | null {
  const pending = new Set<number>();
  let lastHtml: string | null = null;
  for (let i = 0; i < beforeIdx; i++) {
    const a = steps[i].action;
    if (a.driver !== "mcp") continue;
    if (a.kind === "request") {
      const params = a.payload.params as { uri?: string } | null;
      if (a.payload.method === "resources/read" && params?.uri === uri) {
        pending.add(a.payload.id);
      }
    } else if (a.kind === "response" && pending.has(a.payload.requestId)) {
      pending.delete(a.payload.requestId);
      const text = (
        a.payload.result as { contents?: { text?: string }[] } | null
      )?.contents?.[0]?.text;
      if (typeof text === "string") lastHtml = text;
    }
  }
  return lastHtml;
}

/** Replace the first concrete object key after `tools.` (or
 *  `widgets.open[N]`) with a wildcard so generated rules apply
 *  across tools / widget instances. */
export function generalizePath(path: string): string {
  return path
    .replace(/^tools\.[^.[]+/, "tools.*")
    .replace(/^widgets\.open\[\d+\]/, "widgets.open[*]");
}
