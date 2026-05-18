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
  const label = responseLabel(a.payload);
  const took = a.payload.durationMs ? ` (${a.payload.durationMs}ms)` : "";
  if (a.payload.error) {
    return `${label} → error: ${a.payload.error.message}${took}`;
  }
  return `${label} → ok${took}`;
}

function responseLabel(p: {
  tool?: string;
  method?: string;
  resourceUri?: string;
}): string {
  if (p.tool) return p.tool;
  if (p.method === "resources/read" && p.resourceUri) {
    return `resources/read ${p.resourceUri}`;
  }
  return p.method ?? "(response)";
}

function widgetSummary(a: Extract<Action, { driver: "widget" }>): string {
  if (a.kind === "opened") return `opened ${a.payload.uri}`;
  if (a.kind === "runtime_error") return `error: ${a.payload.message}`;
  if (a.kind === "intent") {
    const args = previewValue(a.payload.params);
    return args ? `${a.payload.name} ${args}` : a.payload.name;
  }
  if (a.kind === "render") {
    const out = previewValue(a.payload.mock.toolOutput);
    return out
      ? `render ${a.payload.widgetName} ${out}`
      : `render ${a.payload.widgetName}`;
  }
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
    if (a.payload.tool) {
      return a.payload.error
        ? `expects tools.${a.payload.tool}.lastError`
        : `expects tools.${a.payload.tool}.lastResult`;
    }
    if (a.payload.resourceUri) {
      return a.payload.error
        ? `expects resources["${a.payload.resourceUri}"].lastError`
        : `expects resources["${a.payload.resourceUri}"].lastResult`;
    }
    return a.payload.method
      ? `expects ${a.payload.method} response`
      : "expects response";
  }
  if (a.driver === "widget" && a.kind === "opened") {
    return `expects widgets[${a.payload.uri}]`;
  }
  if (a.driver === "widget" && a.kind === "runtime_error") {
    return "expects widget runtime_error";
  }
  if (a.driver === "widget" && a.kind === "intent") {
    return `expects widgets.intents += { name: "${a.payload.name}" }`;
  }
  if (a.driver === "widget" && a.kind === "render") {
    return `expects widgets.activeRender = { widgetName: "${a.payload.widgetName}" }`;
  }
  if (a.driver === "widget" && a.kind.startsWith("dom.")) {
    return "(no state assertion)";
  }
  return "";
}

/** Structured, un-truncated view of an action's payload, for inspector
 *  display. Each entry is one labelled field of the action's input.
 *  Unlike `actionSummary`, returns the full values so the user can read
 *  the actual data the test will send. Returns an empty array for
 *  actions that have no meaningful input. */
export function actionInputs(
  a: Action,
): Array<{ label: string; value: unknown }> {
  if (a.driver === "studio") {
    if (a.kind === "select")
      return [{ label: "selection", value: a.payload.selection }];
    if (a.kind === "set_args")
      return [{ label: "args", value: a.payload.value }];
    if (a.kind === "set_config")
      return [{ label: "patch", value: a.payload.patch }];
    if (a.kind === "set_mock")
      return [{ label: "mock", value: a.payload.value }];
    return [];
  }
  if (a.driver === "mcp") {
    if (a.kind === "request") {
      if (a.payload.method === "tools/call") {
        const params = a.payload.params as {
          name?: unknown;
          arguments?: unknown;
        } | null;
        return [
          { label: "tool", value: params?.name },
          { label: "arguments", value: params?.arguments },
        ];
      }
      return [
        { label: "method", value: a.payload.method },
        { label: "params", value: a.payload.params },
      ];
    }
    // response
    const out: Array<{ label: string; value: unknown }> = [];
    if (a.payload.method)
      out.push({ label: "responding to", value: a.payload.method });
    if (a.payload.resourceUri)
      out.push({ label: "uri", value: a.payload.resourceUri });
    out.push({ label: "tool", value: a.payload.tool ?? null });
    if (a.payload.error) out.push({ label: "error", value: a.payload.error });
    else out.push({ label: "result", value: a.payload.result });
    if (a.payload.durationMs != null)
      out.push({ label: "durationMs", value: a.payload.durationMs });
    return out;
  }
  if (a.driver === "widget") {
    if (a.kind === "opened") return [{ label: "uri", value: a.payload.uri }];
    if (a.kind === "runtime_error")
      return [{ label: "message", value: a.payload.message }];
    if (a.kind === "intent")
      return [
        { label: "name", value: a.payload.name },
        { label: "params", value: a.payload.params },
      ];
    if (a.kind === "render")
      return [
        { label: "widgetName", value: a.payload.widgetName },
        { label: "mock", value: a.payload.mock },
      ];
    if (a.kind.startsWith("dom.")) {
      const inputs: Array<{ label: string; value: unknown }> = [
        { label: "selectors", value: a.payload.selectors },
      ];
      if (a.kind === "dom.input" || a.kind === "dom.change")
        inputs.push({ label: "value", value: a.payload.value });
      if (a.kind === "dom.keydown")
        inputs.push({ label: "key", value: a.payload.key });
      return inputs;
    }
  }
  return [];
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
