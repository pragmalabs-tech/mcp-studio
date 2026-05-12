/**
 * Trace I/O: load + save the on-disk format.
 *
 * Accepts current Traces (passes through after fold), and legacy Test
 * envelopes (`{ session: { timeline: Recorded[] } }`) by translating
 * the legacy action union into new Actions and folding to fill states.
 */

import { foldTrace } from "./fold";
import { buildInitialState } from "./registry";
import type { Action, Trace, TraceSetup } from "./types";
import type { Recorded } from "@/lib/recorder/schema";

export const SCHEMA_VERSION = 1;

/**
 * Build a Trace directly from a Recorded[] timeline (what the recorder
 * bus emits). Used by save flow: capture full action stream including
 * mcp.response, so recorded ↔ replayed traces align in the differ.
 *
 * The internal mapping is shared with legacy migration; the only
 * difference is that this entry point skips the `session.timeline`
 * unwrapping.
 */
export function toTrace(opts: {
  timeline: readonly Recorded[];
  name: string;
  description?: string;
  id?: string;
  setup?: TraceSetup;
  tags?: string[];
}): Trace {
  const actions = opts.timeline.flatMap((r) => legacyToAction(r));
  pairResponseToolNames(actions);
  return foldTrace({
    schemaVersion: SCHEMA_VERSION,
    id: opts.id ?? cryptoRandomId(),
    name: opts.name,
    description: opts.description,
    capturedAt: new Date().toISOString(),
    setup: opts.setup ?? defaultSetup(),
    initialState: buildInitialState(),
    steps: actions.map((action) => ({
      relMs: 0,
      action,
      stateAfter: buildInitialState(),
    })),
    tags: opts.tags,
  });
}

export function loadTrace(json: unknown): Trace {
  if (!json || typeof json !== "object") {
    throw new Error("loadTrace: input must be an object");
  }
  const v = json as Record<string, unknown>;
  if (typeof v.schemaVersion === "number") return loadCurrent(v);
  if (v.session && typeof v.session === "object") return loadLegacyTest(v);
  throw new Error(
    "loadTrace: unrecognised shape (expected Trace or legacy Test)",
  );
}

export function saveTrace(trace: Trace): unknown {
  // Already JSON-serialisable. Return the value verbatim; callers can
  // JSON.stringify it.
  return trace;
}

// ── current-shape ────────────────────────────────────────────────────────

function loadCurrent(v: Record<string, unknown>): Trace {
  if (v.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `loadTrace: unknown schemaVersion ${String(v.schemaVersion)} (expected ${SCHEMA_VERSION})`,
    );
  }
  for (const k of ["id", "name", "capturedAt"]) {
    if (typeof v[k] !== "string") {
      throw new Error(`loadTrace: missing or invalid '${k}' (string)`);
    }
  }
  if (!v.setup || !v.initialState || !Array.isArray(v.steps)) {
    throw new Error("loadTrace: missing setup/initialState/steps");
  }
  return foldTrace(v as unknown as Trace);
}

// ── legacy `Test` envelope migration ─────────────────────────────────────

interface LegacyTest {
  id?: string;
  name?: string;
  description?: string;
  createdAt?: string;
  session: { timeline?: unknown[] };
}

function loadLegacyTest(v: Record<string, unknown>): Trace {
  const t = v as unknown as LegacyTest;
  return toTrace({
    timeline: (t.session?.timeline ?? []) as Recorded[],
    name: t.name ?? "(unnamed)",
    description: t.description,
    id: t.id,
  });
}

/** Back-fill `mcp.response.payload.tool` from the matching request id.
 *  The legacy recorder paired responses to requests via requestId but
 *  didn't carry the tool name on the response — needed for the diff to
 *  attribute results to the right `state.tools` row. */
function pairResponseToolNames(actions: readonly Action[]): void {
  const toolByReqId: Record<number, string> = {};
  for (const a of actions) {
    if (a.driver !== "mcp") continue;
    if (a.kind === "request" && a.payload.method === "tools/call") {
      const name = (a.payload.params as { name?: unknown } | null)?.name;
      if (typeof name === "string") toolByReqId[a.payload.id] = name;
    } else if (a.kind === "response") {
      const tool = toolByReqId[a.payload.requestId];
      if (tool && !a.payload.tool) {
        (a.payload as { tool?: string }).tool = tool;
      }
    }
  }
}

function legacyToAction(raw: unknown): Action[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== "string") return [];

  // Direct kind matches: legacy and new schemas align.
  if (kind === "mcp.request") {
    const src = r.source;
    const source: "user" | "widget" | "engine" =
      src === "widget" || src === "engine" ? src : "user";
    return [
      {
        driver: "mcp",
        kind: "request",
        source,
        payload: {
          id: Number(r.id),
          method: String(r.method),
          params: r.params,
        },
      },
    ];
  }
  if (kind === "mcp.response") {
    return [
      {
        driver: "mcp",
        kind: "response",
        source: "server",
        payload: {
          requestId: Number(r.requestId),
          durationMs: Number(r.durationMs ?? 0),
          result: r.result,
          error: r.error as { message: string } | undefined,
        },
      },
    ];
  }
  if (
    kind === "widget.dom.click" ||
    kind === "widget.dom.input" ||
    kind === "widget.dom.change" ||
    kind === "widget.dom.submit" ||
    kind === "widget.dom.keydown"
  ) {
    return [
      {
        driver: "widget",
        kind: kind.slice("widget.".length) as
          | "dom.click"
          | "dom.input"
          | "dom.change"
          | "dom.submit"
          | "dom.keydown",
        source: "user",
        payload: r as never,
      },
    ];
  }

  // Studio-shell mappings.
  if (kind === "sidebar.select") {
    return [
      {
        driver: "studio",
        kind: "select",
        source: "user",
        payload: { selection: r.selection as never },
      },
    ];
  }
  if (kind === "editor.set_args") {
    return [
      {
        driver: "studio",
        kind: "set_args",
        source: "user",
        payload: { value: r.value },
      },
    ];
  }
  if (kind === "config.update") {
    return [
      {
        driver: "studio",
        kind: "set_config",
        source: "user",
        payload: { patch: r.patch as never },
      },
    ];
  }
  if (kind === "widget.mock.set") {
    return [
      {
        driver: "studio",
        kind: "set_mock",
        source: "user",
        payload: { value: r.value },
      },
    ];
  }
  if (kind === "widget.intent") {
    return [
      {
        driver: "widget",
        kind: "intent",
        source: "widget",
        payload: {
          name: typeof r.name === "string" ? r.name : "(unknown)",
          params: r.params,
        },
      },
    ];
  }
  if (kind === "widget.render") {
    const initial =
      (r.initialMock as Record<string, unknown> | undefined) ??
      (r.mock as Record<string, unknown> | undefined) ??
      {};
    return [
      {
        driver: "widget",
        kind: "render",
        source: "user",
        payload: {
          widgetName: typeof r.name === "string" ? r.name : "(unknown)",
          mock: {
            toolInput: initial.toolInput,
            toolOutput: initial.toolOutput,
            meta:
              (initial._meta as Record<string, unknown> | undefined) ??
              (initial.meta as Record<string, unknown> | undefined) ??
              {},
            widgetState: initial.widgetState,
          },
        },
      },
    ];
  }

  // Everything else is dropped (auth.update, csp.violation,
  // widget.render.complete, synthetic cue.* kinds — none have state effects
  // in the new model). The differ will surface step_missing if any of them
  // genuinely mattered to the test.
  return [];
}

function defaultSetup(): TraceSetup {
  return { url: "" };
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
