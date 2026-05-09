import type { Recorded, SelectorChain } from "./schema";

export function selectorBrief(s: SelectorChain): string {
  if (s.testid) return `[testid=${s.testid}]`;
  if (s.aria?.label) return `[aria=${s.aria.label}]`;
  if (s.text) return `${s.text.tag}:"${s.text.value}"`;
  if (s.css) return s.css;
  return "(unresolved)";
}

/** Compact inline summary used by both the history list and the run report. */
export function summarize(entry: Recorded): string {
  switch (entry.kind) {
    case "sidebar.select":
      return `${entry.selection.type}:${entry.selection.name}`;
    case "editor.set_args":
      return previewValue(entry.value);
    case "config.update":
      return Object.entries(entry.patch)
        .map(([k, v]) => `${k}=${previewValue(v)}`)
        .join(", ");
    case "auth.update":
      return entry.patch.method ?? "(token)";
    case "mcp.request":
      return `${entry.method} ${argBrief(entry.params)} (${entry.source}) #${entry.id}`;
    case "mcp.response":
      return entry.error
        ? `#${entry.requestId} error: ${entry.error.message}`
        : `#${entry.requestId} ok (${entry.durationMs.toFixed(0)}ms)`;
    case "mcp.notification":
      return entry.method;
    case "widget.render":
      return `${entry.name} (${entry.htmlHash})`;
    case "widget.render.complete":
      return `${entry.bodyChars} chars · ${entry.renderDurationMs.toFixed(0)}ms${
        entry.hasRuntimeErrors ? " · runtime errors" : ""
      }${entry.handshakeOk ? "" : " · no handshake"}`;
    case "widget.mock.set":
      return previewValue(entry.value);
    case "widget.intent":
      return entry.name;
    case "widget.dom.click":
    case "widget.dom.submit":
      return selectorBrief(entry.selectors);
    case "widget.dom.input":
    case "widget.dom.change":
      return `${selectorBrief(entry.selectors)} = ${JSON.stringify(entry.value)}`;
    case "widget.dom.keydown":
      return `${selectorBrief(entry.selectors)} ${entry.key}${
        entry.mods ? ` mods=${entry.mods}` : ""
      }`;
    case "csp.violation":
      return `${entry.directive} ← ${entry.blockedUri}`;
    default:
      return "";
  }
}

function previewValue(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 40) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const json = JSON.stringify(v);
    return json.length > 60 ? json.slice(0, 60) + "…" : json;
  } catch {
    return String(v);
  }
}

/** Pull a friendly arg label out of `tools/call`-style params. */
function argBrief(params: unknown): string {
  if (!params || typeof params !== "object") return "";
  const p = params as { name?: unknown; uri?: unknown };
  if (typeof p.name === "string") return p.name;
  if (typeof p.uri === "string") return p.uri;
  return "";
}

/**
 * Verb-first human-readable label, e.g. "Click [Submit]" or
 * "Call tools/call → get_weather". Used at the top of step rows where the
 * raw action kind ("widget.dom.click") is too jargony for skim reading.
 */
export function verbalize(entry: Recorded): string {
  switch (entry.kind) {
    case "sidebar.select":
      return `Select ${entry.selection.type}: ${entry.selection.name}`;
    case "editor.set_args":
      return `Set args: ${previewValue(entry.value)}`;
    case "config.update": {
      const parts = Object.entries(entry.patch).map(
        ([k, v]) => `${k}=${previewValue(v)}`,
      );
      return `Change ${parts.join(", ")}`;
    }
    case "auth.update":
      return `Update auth (${entry.patch.method ?? "token"})`;
    case "mcp.request": {
      const arg = argBrief(entry.params);
      const verb =
        entry.method === "tools/call"
          ? "Call"
          : entry.method === "resources/read"
            ? "Read"
            : entry.method === "prompts/get"
              ? "Get"
              : "Send";
      return `${verb} ${entry.method}${arg ? ` → ${arg}` : ""} (${entry.source})`;
    }
    case "mcp.response":
      return entry.error
        ? `Response #${entry.requestId} — error: ${entry.error.message}`
        : `Response #${entry.requestId} — ok in ${entry.durationMs.toFixed(0)}ms`;
    case "mcp.notification":
      return `Notification: ${entry.method}`;
    case "widget.render":
      return `Render widget: ${entry.name}`;
    case "widget.render.complete":
      return `Render finished — ${entry.bodyChars} chars in ${entry.renderDurationMs.toFixed(0)}ms`;
    case "widget.mock.set":
      return `Set mock data`;
    case "widget.intent": {
      const friendly: Record<string, string> = {
        "ui/open-link": "Open link",
        "ui/openLink": "Open link",
        "ui/setState": "Set widget state",
        "ui/set-state": "Set widget state",
        "ui/sendMessage": "Send message",
        "ui/message": "Send message",
        "ui/request-display-mode": "Request display mode",
        "ui/requestDisplayMode": "Request display mode",
      };
      return friendly[entry.name] ?? `Widget intent: ${entry.name}`;
    }
    case "widget.dom.click":
      return `Click ${selectorBrief(entry.selectors)}`;
    case "widget.dom.submit":
      return `Submit ${selectorBrief(entry.selectors)}`;
    case "widget.dom.input":
      return `Type ${JSON.stringify(entry.value)} in ${selectorBrief(entry.selectors)}`;
    case "widget.dom.change":
      return `Change ${selectorBrief(entry.selectors)} to ${JSON.stringify(entry.value)}`;
    case "widget.dom.keydown":
      return `Press ${entry.key}${entry.mods ? ` (mods=${entry.mods})` : ""} on ${selectorBrief(entry.selectors)}`;
    case "csp.violation":
      return `CSP violation: ${entry.directive} ← ${entry.blockedUri}`;
    default:
      return summarize(entry);
  }
}

/**
 * Why is this kind of action a no-op for the player? Used for skip reasons in
 * the run report so users understand observation steps aren't "broken".
 */
export function skipReasonForKind(kind: Recorded["kind"]): string {
  switch (kind) {
    case "mcp.response":
      return "observation — paired with the prior mcp.request";
    case "mcp.notification":
      return "observation — server-pushed notification";
    case "widget.render.complete":
      return "observation — captured when the widget finished loading";
    case "widget.intent":
      return "observation — widget posted a non-tool intent";
    case "csp.violation":
      return "observation — CSP violation captured during render";
    default:
      return "no driver registered for this kind";
  }
}
