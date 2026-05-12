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
  /** Comparison strategy for this step's stateAfter when running the
   *  differ. Defaults to "exact". "shape" checks JSON shape/types only,
   *  allowing leaf values and array lengths to differ. Use for tool
   *  responses with content that legitimately varies across envs. */
  compare?: "exact" | "shape";
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
  /** Per-trace assertion rules, additive on top of built-in driver
   *  defaults. Optional — traces without it get only the defaults. */
  rules?: TraceRules;
  /** Free-form labels for organizing/filtering. Lowercased, trimmed,
   *  deduped on save. */
  tags?: string[];
}

// ── Rules ────────────────────────────────────────────────────────────────
// Per-trace rule additions on top of driver-level defaults. Rules suppress
// or reshape what would otherwise be a drift:
//   ignore — drop the disagreement entirely.
//   match  — replace exact-equality with a shape/format assertion.

export type Matcher =
  | "@any" // any value, both sides present
  | "@iso8601" // ISO-8601 datetime string
  | "@uuid" // UUID (any version)
  | "@epoch" // integer >= 1e9 (seconds or ms)
  | { regex: string };

export interface TraceRules {
  /** Additive path globs whose value differences are suppressed. */
  ignore?: string[];
  /** Path glob → matcher. Path glob uses the same `*` / `[*]` semantics
   *  as `matchesAnyPattern`. */
  match?: Record<string, Matcher>;
}

/** Resolved layered rules ready for the differ. Built by `resolveRules()` */
export interface ResolvedRules {
  ignore: ReadonlyArray<{
    pattern: string;
    layer: "builtin.ignore" | "trace.ignore";
  }>;
  /** Ordered so trace entries come AFTER builtin entries; the LAST
   *  matching pattern wins. */
  match: ReadonlyArray<{
    pattern: string;
    matcher: Matcher;
    layer: "builtin.match" | "trace.match";
  }>;
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
  /** When set, the drift was suppressed by a rule and should not count
   *  against `Verdict.ok`. UI may still surface these in a "suppressed"
   *  view for explainability. */
  suppressedBy?: {
    layer: "builtin.ignore" | "builtin.match" | "trace.ignore" | "trace.match";
    pattern: string;
  };
  /** Heuristic guess at what kind of value differed. Set only by the
   *  auto-classifier on fail drifts where both sides share a known
   *  shape (datetime, UUID, secret, etc.). Drives the UI's suggestion
   *  banner. Suggesting a rule does NOT change verdict/severity. */
  classification?: Classification;
}

export type ClassificationKind =
  | "iso8601"
  | "uuid"
  | "epoch"
  | "jwt"
  | "aws_key"
  | "stripe_key"
  | "high_entropy";

export interface Classification {
  kind: ClassificationKind;
  /** True if the value should be considered secret — the UI masks it
   *  and the default suggestion is `ignore`, never `match`. */
  sensitive: boolean;
  /** Concrete rule the UI offers to add. `match` for shape-stable
   *  values (datetime, UUID, epoch); `ignore` for high-entropy /
   *  secret-shaped values where shape-asserting would still leak. */
  suggested: SuggestedRule;
}

export type SuggestedRule = { match: Matcher } | { ignore: true };

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
  /** Optional shape-matcher defaults for paths owned by this driver.
   *  Keyed by path glob relative to the driver's slice key (the registry
   *  prefixes them just like `volatilePaths`). */
  matchPaths?(): Readonly<Record<string, Matcher>>;
  dispatch?(action: A, ctx: DispatchCtx): Promise<void>;
  attach?(emit: (action: Action) => void, ctx: AttachCtx): () => void;
}

export interface DispatchCtx {
  readonly signal: AbortSignal;
}

export interface AttachCtx {
  readonly signal: AbortSignal;
}
