/**
 * Human-readable summaries of Action records, shared by the catalog
 * list and the trace replay modal.
 */

import type { Action, Trace } from "./types";

export function actionLabel(a: Action): string {
  return `${a.driver}.${a.kind}`;
}

export function actionSummary(a: Action): string {
  if (a.driver === "studio") return studioSummary(a);
  if (a.driver === "mcp") return mcpSummary(a);
  if (a.driver === "widget") return widgetSummary(a);
  return "";
}

function studioSummary(a: Extract<Action, { driver: "studio" }>): string {
  if (a.kind === "select") {
    const s = a.payload.selection;
    return s ? `select ${s.type}: ${s.name}` : "clear selection";
  }
  if (a.kind === "set_args") return `set args ${previewValue(a.payload.value)}`;
  if (a.kind === "set_config")
    return `set config ${previewObject(a.payload.patch)}`;
  if (a.kind === "set_mock") return `set mock ${previewValue(a.payload.value)}`;
  return "";
}

function mcpSummary(a: Extract<Action, { driver: "mcp" }>): string {
  if (a.kind === "request") {
    if (a.payload.method === "tools/call") {
      const params = a.payload.params as {
        name?: unknown;
        arguments?: unknown;
      } | null;
      const name = typeof params?.name === "string" ? params.name : "(?)";
      const args = previewValue(params?.arguments);
      return args ? `call ${name} ${args}` : `call ${name}`;
    }
    return `${a.payload.method} ${previewValue(a.payload.params)}`.trimEnd();
  }
  // response
  const tool = a.payload.tool ?? "(response)";
  const took = a.payload.durationMs ? ` (${a.payload.durationMs}ms)` : "";
  if (a.payload.error) {
    return `${tool} → error: ${a.payload.error.message}${took}`;
  }
  return `${tool} → ok${took}`;
}

function widgetSummary(a: Extract<Action, { driver: "widget" }>): string {
  if (a.kind === "opened") return `opened ${a.payload.uri}`;
  if (a.kind === "runtime_error") return `error: ${a.payload.message}`;
  const sel = selectorLabel(a.payload.selectors);
  if (a.kind === "dom.click") return `click ${sel}`;
  if (a.kind === "dom.submit") return `submit ${sel}`;
  if (a.kind === "dom.input") {
    return `input ${sel} = ${truncate(JSON.stringify(a.payload.value), 32)}`;
  }
  if (a.kind === "dom.change") {
    return `change ${sel} = ${truncate(JSON.stringify(a.payload.value), 32)}`;
  }
  if (a.kind === "dom.keydown") return `keydown ${a.payload.key} on ${sel}`;
  return "";
}

function selectorLabel(
  sel:
    | {
        testid?: string;
        aria?: { label?: string };
      }
    | undefined,
): string {
  return sel?.testid ?? sel?.aria?.label ?? "(selector)";
}

/** Brief preview for arbitrary payload values. Objects render as
 *  `{ a, b }` (keys only). Primitives render as their JSON form,
 *  truncated. Returns empty string for null/undefined. */
function previewValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (Array.isArray(v)) return `[${v.length} items]`;
    return previewObject(v as Record<string, unknown>);
  }
  return truncate(JSON.stringify(v), 32);
}

function previewObject(o: Record<string, unknown>): string {
  const keys = Object.keys(o);
  if (keys.length === 0) return "{}";
  const head = keys.slice(0, 3).join(", ");
  const more = keys.length > 3 ? `, +${keys.length - 3}` : "";
  return `{ ${head}${more} }`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/** One-line "what does the test assert at this step" hint, derived from
 *  the action's expected state mutation. Used in the catalog list as a
 *  secondary line below the summary so users see what each step proves. */
export function actionExpectation(a: Action): string {
  if (a.driver === "studio" && a.kind === "select") {
    const s = a.payload.selection;
    return s
      ? `expects studio.selected = ${s.type}:${s.name}`
      : "expects studio.selected = null";
  }
  if (a.driver === "studio" && a.kind === "set_config") {
    const keys = Object.keys(a.payload.patch ?? {});
    return keys.length > 0
      ? `expects studio config { ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""} }`
      : "";
  }
  if (a.driver === "mcp" && a.kind === "request") {
    if (a.payload.method === "tools/call") {
      const name =
        (a.payload.params as { name?: unknown } | null)?.name ?? "(?)";
      return `expects tools.${name}.callCount + 1`;
    }
    return `sends ${a.payload.method}`;
  }
  if (a.driver === "mcp" && a.kind === "response") {
    const tool = a.payload.tool ?? "(response)";
    if (a.payload.error) return `expects tools.${tool}.lastError`;
    return `expects tools.${tool}.lastResult`;
  }
  if (a.driver === "widget" && a.kind === "opened") {
    return `expects widgets[${a.payload.uri}]`;
  }
  if (a.driver === "widget" && a.kind === "runtime_error") {
    return "expects widget runtime_error";
  }
  if (a.driver === "widget" && a.kind.startsWith("dom.")) {
    return "(no state assertion)";
  }
  return "";
}

/** Unique tool names invoked by `tools/call` requests in this trace,
 *  in first-call order. Used in the result modal header to summarize
 *  what the test exercises. */
export function primaryMethods(trace: Trace): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const step of trace.steps) {
    const a = step.action;
    if (a.driver !== "mcp" || a.kind !== "request") continue;
    if (a.payload.method !== "tools/call") continue;
    const name = (a.payload.params as { name?: unknown } | null)?.name;
    if (typeof name === "string" && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
