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
import { stripUndefined } from "./util/strip-undefined";
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
  pairResponseToRequest(actions);
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
  // Back-fill response attribution fields on previously-saved traces:
  // older recordings only stamped `tool`; `method` and `resourceUri`
  // arrived later. Re-fold after the patch so step.stateAfter reflects
  // the new resources slice projections.
  const steps = v.steps as Array<{ action: Action }>;
  pairResponseToRequest(steps.map((s) => s.action));
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

/** Back-fill `mcp.response.payload.{method, tool, resourceUri}` from the
 *  matching request id. Required for legacy traces (the old recorder
 *  paired by id but didn't stamp the response) and for previously-saved
 *  current-shape traces (recorded before `method`/`resourceUri` were
 *  stamped). Without this, response steps can't attribute to the right
 *  `tools.{name}` / `resources["uri"]` row. Mutates in place. */
function pairResponseToRequest(actions: readonly Action[]): void {
  const reqById = new Map<
    number,
    { method: string; params: unknown; toolName?: string }
  >();
  for (const a of actions) {
    if (a.driver !== "mcp") continue;
    if (a.kind === "request") {
      const toolName =
        a.payload.method === "tools/call"
          ? (a.payload.params as { name?: unknown } | null)?.name
          : undefined;
      reqById.set(a.payload.id, {
        method: a.payload.method,
        params: a.payload.params,
        toolName: typeof toolName === "string" ? toolName : undefined,
      });
      continue;
    }
    if (a.kind === "response") {
      const req = reqById.get(a.payload.requestId);
      if (!req) continue;
      const p = a.payload as {
        method?: string;
        tool?: string;
        resourceUri?: string;
      };
      if (!p.method) p.method = req.method;
      if (!p.tool && req.toolName) p.tool = req.toolName;
      if (!p.resourceUri && req.method === "resources/read") {
        const uri = (req.params as { uri?: unknown } | null)?.uri;
        if (typeof uri === "string") p.resourceUri = uri;
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
          // Mirror JSON storage semantics so live + saved traces match.
          // See drivers/widget.ts widgetAttach for the symmetric strip.
          params: stripUndefined(r.params),
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
