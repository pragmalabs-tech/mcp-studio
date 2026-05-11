/**
 * Canonical types: state(n) = transition(state(n-1), action(n)).
 * Three nouns — Action, State, Trace. One verdict — pairwise State diff.
 */

import type { SelectorChain } from "@/lib/recorder/schema";

export type DriverId = "studio" | "mcp" | "widget";

/** Drives the engine's drive-vs-await decision on replay. */
export type ActionSource = "user" | "engine" | "widget" | "server";

// ── Actions ──────────────────────────────────────────────────────────────

export type Action = StudioAction | McpAction | WidgetAction;

export type StudioAction =
  | {
      driver: "studio";
      kind: "select";
      source: "user";
      payload: {
        selection: { type: "tool" | "resource"; name: string } | null;
      };
    }
  | {
      driver: "studio";
      kind: "set_args";
      source: "user";
      payload: { value: unknown };
    }
  | {
      driver: "studio";
      kind: "set_config";
      source: "user";
      payload: { patch: Partial<StudioConfig> };
    }
  | {
      driver: "studio";
      kind: "set_mock";
      source: "user";
      payload: { value: unknown };
    };

export type McpAction =
  | {
      driver: "mcp";
      kind: "request";
      source: "user" | "widget" | "engine";
      payload: { id: number; method: string; params: unknown };
    }
  // `tool` is set at capture time when the request was tools/call so the
  // transition attributes the result to the right tools.{name} row.
  | {
      driver: "mcp";
      kind: "response";
      source: "server";
      payload: {
        requestId: number;
        tool?: string;
        durationMs: number;
        result?: unknown;
        error?: { message: string };
      };
    };

export type WidgetAction =
  | {
      driver: "widget";
      kind: "opened";
      source: "engine";
      payload: { uri: string; data: unknown };
    }
  | {
      driver: "widget";
      kind: "runtime_error";
      source: "widget";
      payload: { message: string };
    }
  | {
      driver: "widget";
      kind: "dom.click";
      source: "user";
      payload: { selectors: SelectorChain };
    }
  | {
      driver: "widget";
      kind: "dom.input";
      source: "user";
      payload: { selectors: SelectorChain; value: string; inputType: string };
    }
  | {
      driver: "widget";
      kind: "dom.change";
      source: "user";
      payload: { selectors: SelectorChain; value: string };
    }
  | {
      driver: "widget";
      kind: "dom.submit";
      source: "user";
      payload: { selectors: SelectorChain };
    }
  | {
      driver: "widget";
      kind: "dom.keydown";
      source: "user";
      payload: {
        selectors: SelectorChain;
        key: string;
        code: string;
        mods: number;
      };
    };

// ── State ────────────────────────────────────────────────────────────────
// Scoreboard of facts a test would assert on. Studio shell mutations
// belong here (user changes them mid-test). Env config (URL, auth) lives
// in Trace.setup. Runtime plumbing (iframes, bridges) is never in State.

export interface State {
  studio: StudioSlice;
  tools: ToolsSlice;
  widgets: WidgetsSlice;
  network: NetworkSlice;
}

export interface StudioConfig {
  theme: string;
  viewport: { preset: string } | { width: number; height: number };
  displayMode: string;
  locale: string;
  strictMode: boolean;
}

export interface StudioSlice extends StudioConfig {
  selected: { type: "tool" | "resource"; name: string } | null;
  editor: { args: unknown };
  mock: unknown;
}

export type ToolsSlice = Record<string, ToolStats>;

export interface ToolStats {
  callCount: number;
  lastResult?: unknown;
  lastError?: { message: string };
}

export interface WidgetsSlice {
  renderCount: number;
  open: OpenWidget[];
}

export interface OpenWidget {
  uri: string;
  data: unknown;
  mounted: boolean;
  hasErrors: boolean;
}

export interface NetworkSlice {
  requestCount: number;
  responseCount: number;
  errorCount: number;
}

// ── Trace ────────────────────────────────────────────────────────────────

export interface TraceSetup {
  url: string;
  profileId?: string;
}

export interface Step {
  relMs: number;
  action: Action;
  stateAfter: State;
}

export interface Trace {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  capturedAt: string;
  setup: TraceSetup;
  initialState: State;
  steps: Step[];
}

// ── Verdict ──────────────────────────────────────────────────────────────

export interface Verdict {
  ok: boolean;
  drifts: Drift[];
}

export interface Drift {
  stepIndex: number;
  path: string;
  expected: unknown;
  actual: unknown;
  reason: DriftReason;
  severity: DriftSeverity;
}

export type DriftReason =
  | "missing"
  | "extra"
  | "value_differs"
  | "type_differs"
  | "step_missing"
  | "step_extra";

export type DriftSeverity = "fail" | "warn";

// ── Driver ───────────────────────────────────────────────────────────────
// Phase 1: id, initialSlice, apply, volatilePaths (pure).
// Phase 5: dispatch, attach (live execution).
// Phase 6: views (UI rendering).
//
// Slice ownership: studio→studio; mcp→tools+network; widget→widgets+network.
// Drivers may read any slice but must only WRITE the ones they own.

export interface Driver<A extends Action = Action> {
  readonly id: DriverId;
  initialSlice(): unknown;
  apply(state: State, action: A): State;
  volatilePaths(): readonly string[];
  dispatch?(action: A, ctx: DispatchCtx): Promise<void>;
  attach?(emit: (action: Action) => void, ctx: AttachCtx): () => void;
}

export interface DispatchCtx {
  readonly signal: AbortSignal;
}

export interface AttachCtx {
  readonly signal: AbortSignal;
}
