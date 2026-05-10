/**
 * Driver for the synthetic kinds the Cue → IR translator emits:
 * `cue.assert`, `cue.wait`, `cue.notify`, `cue.expect_inbound`,
 * `cue.widget_open`. The actual assertion work is done by
 * `lib/cue/assertions.ts:evaluateBundle`, called by the engine's run loop
 * after the driver returns. This driver dispatches the side effect (or
 * no-op for asserts) so the engine has something to time.
 *
 * Adding a new `cue.*` kind: declare it in `kinds.ts` + `schema.ts`, then
 * add one entry to `HANDLERS` below. The exposed `kinds` array is derived
 * from the registry so the two never drift.
 */

import type { Action, ActionKind } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";
import { timeoutFor } from "@/lib/engine/timing";
import type { Driver, DriverContext, DriveOutcome } from "./types";

/** Cue-synthetic action kinds this driver handles. */
type CueKind =
  | typeof KIND.CUE_ASSERT
  | typeof KIND.CUE_WAIT
  | typeof KIND.CUE_NOTIFY
  | typeof KIND.CUE_EXPECT_INBOUND
  | typeof KIND.CUE_WIDGET_OPEN;

type CueAction<K extends CueKind> = Extract<Action, { kind: K }>;

type Handler<K extends CueKind> = (
  action: CueAction<K>,
  ctx: DriverContext,
  startedAt: number,
) => Promise<DriveOutcome>;

/** How long to give the studio to load the widget iframe + editor between
 *  `select()` and `execute()`. `select()` schedules `loadWidget` via a 50ms
 *  timeout; we wait a touch longer to be safe. */
const SELECT_SETTLE_MS = 80;

const HANDLERS: { [K in CueKind]: Handler<K> } = {
  [KIND.CUE_ASSERT]: async (_action, _ctx, t0) => {
    // Assertion-only step. The bundle on `_cue` does the real work after
    // the driver returns; here we just succeed so the engine moves to
    // the assertion runner.
    return { ok: true, durationMs: performance.now() - t0 };
  },

  [KIND.CUE_WAIT]: async (action, ctx, t0) => {
    await sleep(action.ms, ctx.signal);
    return { ok: true, durationMs: performance.now() - t0 };
  },

  [KIND.CUE_NOTIFY]: async (action, _ctx, t0) => {
    const ok = await postNotification(action.method, action.params);
    return ok
      ? { ok: true, durationMs: performance.now() - t0 }
      : {
          ok: false,
          reason: "notification dispatch failed",
          durationMs: performance.now() - t0,
        };
  },

  [KIND.CUE_EXPECT_INBOUND]: async (action, ctx, t0) => {
    // TODO: when bus emissions for inbound server-initiated requests
    // start carrying a stable identifier we want to match on, fold a
    // `requestId` filter into this predicate (currently matches first
    // event by method, which is fine because v1 doesn't have concurrent
    // server-initiated requests).
    const observed = await ctx.onObservation(
      (e) =>
        (action.type === "notification"
          ? e.kind === KIND.MCP_NOTIFICATION
          : e.kind === KIND.MCP_REQUEST) &&
        (e as { method?: string }).method === action.method,
      action.timeoutMs,
    );
    if (!observed) {
      return {
        ok: false,
        reason: `no inbound ${action.type} for ${action.method} within ${action.timeoutMs}ms`,
        durationMs: performance.now() - t0,
      };
    }
    return {
      ok: true,
      observation: observed,
      durationMs: performance.now() - t0,
    };
  },

  [KIND.CUE_WIDGET_OPEN]: async (action, ctx, t0) => {
    // Drive the studio's existing widget render path: select the tool,
    // override editor args, execute. Reuses the proven UI pipeline so
    // widgets render exactly as a human user would see them. The
    // observation surfaces both the tool's MCP result and the bridge's
    // render.complete payload, so the cue assertion bundle can match
    // either via `result_match` or `no_runtime_errors`.
    const tool = ctx.store.getState().tools.find((t) => t.name === action.tool);
    if (!tool) {
      return {
        ok: false,
        reason: `tool "${action.tool}" not on server`,
        durationMs: performance.now() - t0,
      };
    }
    // Pre-flight: the tool definition must declare a widget reference,
    // either via Claude's `meta.ui.resourceUri` / `meta.ui.uri` or
    // OpenAI's `meta["openai/outputTemplate"]`. Fail fast so we don't
    // wait the full render timeout on a tool that has no widget.
    if (!toolDeclaresWidget(tool.meta)) {
      return {
        ok: false,
        reason: `tool "${action.tool}" does not declare a widget UI (no _meta.ui.resourceUri / _meta.openai/outputTemplate)`,
        durationMs: performance.now() - t0,
      };
    }
    ctx.store.select({ type: "tool", tool });
    await sleep(SELECT_SETTLE_MS, ctx.signal);
    ctx.store.setEditorValue(JSON.stringify(action.args ?? {}, null, 2));
    const renderPromise = ctx.bridge
      .awaitRenderComplete(timeoutFor(KIND.WIDGET_RENDER))
      .catch(() => null);
    try {
      await ctx.store.execute();
    } catch (err) {
      return {
        ok: false,
        reason: `execute failed: ${(err as Error).message}`,
        durationMs: performance.now() - t0,
      };
    }
    const renderResult = await renderPromise;
    const lastResult = ctx.store.getState().lastResult;
    return {
      ok: true,
      observation: { result: lastResult, render: renderResult },
      durationMs: performance.now() - t0,
    };
  },
};

const KINDS = Object.keys(HANDLERS) as ActionKind[];

export const cueDriver: Driver<Action> = {
  kinds: KINDS,
  drive(action, ctx) {
    const handler = HANDLERS[action.kind as CueKind] as
      | Handler<CueKind>
      | undefined;
    if (!handler) {
      return Promise.resolve({
        ok: false,
        reason: "unsupported-kind",
        durationMs: 0,
      });
    }
    return handler(action as CueAction<CueKind>, ctx, performance.now());
  },
};

/** True when the tool's `meta` carries a widget reference under any of the
 *  known conventions (Claude, OpenAI Apps SDK, mcpr). Mirrors the studio's
 *  `extractWidgetUri` in `lib/studio/store.ts` so behavior matches what a
 *  human user would see when selecting the tool in the sidebar. */
function toolDeclaresWidget(
  meta: Record<string, unknown> | undefined,
): boolean {
  if (!meta) return false;
  const ui = meta.ui as Record<string, unknown> | undefined;
  if (
    ui &&
    (typeof ui.resourceUri === "string" || typeof ui.uri === "string")
  ) {
    return true;
  }
  if (typeof meta["openai/outputTemplate"] === "string") return true;
  return false;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function postNotification(
  method: string,
  params: unknown,
): Promise<boolean> {
  try {
    const proxyUrl = `/api/mcp-proxy?url=${encodeURIComponent(
      // The studio's existing proxy is same-origin; the MCP base URL
      // comes from the studio store, but for fire-and-forget we POST
      // directly via the proxy, which already injects auth headers.
      window.location.origin,
    )}`;
    const resp = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: params ?? undefined,
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
