import type { Action, ActionKind } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";
import type { Driver, DriveOutcome } from "./types";
import { mcpCall } from "@/lib/studio/api";
import { timeoutFor } from "@/lib/engine/timing";

const KINDS: ActionKind[] = [KIND.MCP_REQUEST];

/**
 * Drives a recorded `mcp.request`. For `source: "user"` it issues the call
 * via `store.execute()` so the widget render side effect happens naturally.
 * For `source: "widget"` it's treated as an observation — the widget will
 * fire (or not) as a side effect of its own code; the player doesn't try to
 * gate progress on it.
 */
export const mcpDriver: Driver<Action> = {
  kinds: KINDS,
  async drive(action, ctx): Promise<DriveOutcome> {
    if (action.kind !== KIND.MCP_REQUEST) {
      return { ok: false, reason: "wrong-kind", durationMs: 0 };
    }

    const t0 = performance.now();

    if (action.source === "widget") {
      // Widget-initiated requests fire as a side effect of widget code
      // running inside the iframe. The player can't deterministically
      // trigger them — they happen (or don't) when the widget renders /
      // reacts to dispatched DOM events. Mark these as pass-through so
      // they don't gate the timeline.
      return {
        ok: true,
        observation: { skipped: "widget-initiated request" },
        durationMs: performance.now() - t0,
      };
    }

    // source === "user". For tools/call and resources/read, prefer the
    // higher-level store.execute() — it re-uses the existing selection +
    // editor state so the widget render side effect happens naturally.
    // Fall back to a raw mcpCall for other methods (e.g., prompts/get).
    const useExecute =
      (action.method === "tools/call" || action.method === "resources/read") &&
      ctx.store.getState().selected !== null;

    try {
      let observation: unknown;
      if (useExecute) {
        // Register the response listener BEFORE triggering execute() —
        // execute() emits mcp.response synchronously inside its callTool
        // chain; if we awaited the listener creation first we'd race past
        // the emission and time out.
        const responsePromise = ctx.onObservation(
          (e) => e.kind === KIND.MCP_RESPONSE,
          timeoutFor(KIND.MCP_REQUEST),
        );
        await ctx.store.execute();
        observation = await responsePromise;
      } else {
        const result = await mcpCall(
          action.method,
          action.params as Record<string, unknown>,
        );
        observation = { result, durationMs: performance.now() - t0 };
      }
      return {
        ok: true,
        observation,
        durationMs: performance.now() - t0,
      };
    } catch (err) {
      return {
        ok: true,
        observation: { error: { message: (err as Error).message } },
        durationMs: performance.now() - t0,
      };
    }
  },
};
