import type { Action, ActionKind } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";
import type { Driver, DriveOutcome } from "./types";
import { mcpCall } from "@/lib/studio/api";

const KINDS: ActionKind[] = [KIND.MCP_REQUEST];

/**
 * Drives a recorded `mcp.request`. The action is the source of truth —
 * we send `action.method` with `action.params` directly via `mcpCall`,
 * never read the studio's selected item. (Earlier versions delegated to
 * `store.execute()` for tools/call and resources/read; that branch
 * silently swapped the call to whatever was selected in the UI, which
 * broke Cue replay because Cues don't emit `sidebar.select`.)
 *
 * Widget rendering for `widget.open` flows through the dedicated
 * `cue.widget_open` synthetic kind in `drivers/cue.ts`, not this driver.
 *
 * `source: "widget"` requests are pass-through. Widget-initiated calls
 * fire as a side effect of widget code running in the iframe; the player
 * can't deterministically trigger them.
 */
export const mcpDriver: Driver<Action> = {
  kinds: KINDS,
  async drive(action, _ctx): Promise<DriveOutcome> {
    if (action.kind !== KIND.MCP_REQUEST) {
      return { ok: false, reason: "wrong-kind", durationMs: 0 };
    }

    const t0 = performance.now();

    if (action.source === "widget") {
      return {
        ok: true,
        observation: { skipped: "widget-initiated request" },
        durationMs: performance.now() - t0,
      };
    }

    try {
      const result = await mcpCall(
        action.method,
        action.params as Record<string, unknown>,
      );
      return {
        ok: true,
        observation: { result, durationMs: performance.now() - t0 },
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
