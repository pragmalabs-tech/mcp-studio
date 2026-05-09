import type { ActionKind } from "./schema";

/**
 * Centralized constants for every Action.kind value. Use these instead of
 * raw string literals when registering drivers, building lookup maps, or
 * filtering by kind.
 *
 * The `satisfies Record<string, ActionKind>` annotation ensures every value
 * here is a known ActionKind — adding `KIND.FOO = "foo"` for a kind not in
 * the schema fails to compile. The `as const` keeps each value as a string
 * literal type so callers narrow correctly in switches.
 */
export const KIND = {
  // pure inputs (driven by chrome driver)
  SIDEBAR_SELECT: "sidebar.select",
  EDITOR_SET_ARGS: "editor.set_args",
  CONFIG_UPDATE: "config.update",
  AUTH_UPDATE: "auth.update",
  WIDGET_MOCK_SET: "widget.mock.set",

  // mcp boundary
  MCP_REQUEST: "mcp.request",
  MCP_RESPONSE: "mcp.response",
  MCP_NOTIFICATION: "mcp.notification",

  // widget side
  WIDGET_RENDER: "widget.render",
  WIDGET_RENDER_COMPLETE: "widget.render.complete",
  WIDGET_INTENT: "widget.intent",
  WIDGET_DOM_CLICK: "widget.dom.click",
  WIDGET_DOM_INPUT: "widget.dom.input",
  WIDGET_DOM_CHANGE: "widget.dom.change",
  WIDGET_DOM_SUBMIT: "widget.dom.submit",
  WIDGET_DOM_KEYDOWN: "widget.dom.keydown",

  // observations
  CSP_VIOLATION: "csp.violation",
} as const satisfies Record<string, ActionKind>;

/** Every action kind, in stable declaration order. */
export const ALL_KINDS: readonly ActionKind[] = Object.values(KIND);

/** Kinds the player can't drive — they happen as side effects of other
 *  actions. The "Inputs only" filter hides these. */
export const OBSERVATION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  KIND.MCP_RESPONSE,
  KIND.MCP_NOTIFICATION,
  KIND.WIDGET_RENDER_COMPLETE,
  KIND.WIDGET_INTENT,
  KIND.CSP_VIOLATION,
]);

/** All `widget.dom.*` kinds the bridge can dispatch. */
export const WIDGET_DOM_KINDS: readonly ActionKind[] = [
  KIND.WIDGET_DOM_CLICK,
  KIND.WIDGET_DOM_INPUT,
  KIND.WIDGET_DOM_CHANGE,
  KIND.WIDGET_DOM_SUBMIT,
  KIND.WIDGET_DOM_KEYDOWN,
];
