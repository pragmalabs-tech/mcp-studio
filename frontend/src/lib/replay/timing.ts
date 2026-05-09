import type { ActionKind } from "@/lib/recorder/schema";

/** Per-kind timeout (ms) for the natural follow-up observation. */
export const TIMEOUTS: Partial<Record<ActionKind, number>> = {
  "mcp.request": 10_000,
  "widget.render": 5_000,
  "widget.dom.click": 2_000,
  "widget.dom.input": 1_500,
  "widget.dom.change": 1_500,
  "widget.dom.submit": 3_000,
  "widget.dom.keydown": 500,
  "widget.intent": 2_000,
};

export const DEFAULT_TIMEOUT = 1_000;

export function timeoutFor(kind: ActionKind): number {
  return TIMEOUTS[kind] ?? DEFAULT_TIMEOUT;
}
