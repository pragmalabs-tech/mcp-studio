/**
 * Test fixtures for the state-driven core.
 *
 * Builders are deliberately minimal — they return the shapes tests need
 * without smuggling in defaults that mask bugs. Each builder takes
 * optional overrides via shallow merge so tests stay readable.
 */

import { buildInitialState } from "../registry";
import type {
  Action,
  McpAction,
  State,
  Step,
  StudioAction,
  Trace,
  WidgetAction,
} from "../types";

// ── State builders ─────────────────────────────────────────────────────────

/** A fresh, empty State equal to what the registry composes for a new
 *  test. Identical to calling `buildInitialState()`; re-exported here so
 *  test files don't need to know about the registry. */
export function emptyState(): State {
  return buildInitialState();
}

/** Build a State by overriding individual slices. Useful for "given the
 *  state already has tools.X with callCount: 2…" set-ups. Sub-slices are
 *  shallow-merged with the empty default, so tests don't have to spell
 *  out every required field on a slice they're not exercising. */
export function makeState(overrides: StateOverrides = {}): State {
  const base = emptyState();
  return {
    studio: overrides.studio
      ? { ...base.studio, ...overrides.studio }
      : base.studio,
    tools: overrides.tools ?? base.tools,
    resources: overrides.resources ?? base.resources,
    widgets: overrides.widgets
      ? { ...base.widgets, ...overrides.widgets }
      : base.widgets,
    network: overrides.network
      ? { ...base.network, ...overrides.network }
      : base.network,
  };
}

interface StateOverrides {
  studio?: Partial<State["studio"]>;
  tools?: State["tools"];
  resources?: State["resources"];
  widgets?: Partial<State["widgets"]>;
  network?: Partial<State["network"]>;
}

// ── Action builders ────────────────────────────────────────────────────────

/** Build a Studio Action with the right driver/source defaults so tests
 *  read like the schema. The function intentionally lists the full
 *  payload union to keep the call sites explicit. */
export function studioAction<K extends StudioAction["kind"]>(
  kind: K,
  payload: Extract<StudioAction, { kind: K }>["payload"],
): StudioAction {
  return { driver: "studio", kind, source: "user", payload } as StudioAction;
}

export function mcpAction<K extends McpAction["kind"]>(
  kind: K,
  payload: Extract<McpAction, { kind: K }>["payload"],
  source: McpAction["source"] = kind === "response" ? "server" : "user",
): McpAction {
  return { driver: "mcp", kind, source, payload } as McpAction;
}

export function widgetAction<K extends WidgetAction["kind"]>(
  kind: K,
  payload: Extract<WidgetAction, { kind: K }>["payload"],
  source: WidgetAction["source"] = inferWidgetSource(kind),
): WidgetAction {
  return { driver: "widget", kind, source, payload } as WidgetAction;
}

function inferWidgetSource(kind: WidgetAction["kind"]): WidgetAction["source"] {
  if (kind === "opened") return "engine";
  if (kind === "runtime_error") return "widget";
  if (kind === "intent") return "widget";
  return "user";
}

// ── Trace builders ─────────────────────────────────────────────────────────

/** Build a Trace from an ordered list of (Action, stateAfter) pairs.
 *  `relMs` defaults to 10ms increments per step; pass an array of
 *  numbers to override. */
export function makeTrace(opts: {
  steps: Array<{ action: Action; stateAfter: State; relMs?: number }>;
  initialState?: State;
  name?: string;
}): Trace {
  const initialState = opts.initialState ?? emptyState();
  const steps: Step[] = opts.steps.map((s, i) => ({
    relMs: s.relMs ?? (i + 1) * 10,
    action: s.action,
    stateAfter: s.stateAfter,
  }));
  return {
    schemaVersion: 1,
    id: "test-trace",
    name: opts.name ?? "test",
    capturedAt: new Date(0).toISOString(),
    setup: { url: "http://localhost" },
    initialState,
    steps,
  };
}
