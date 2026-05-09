import type { ActionKind } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";

/** Per-kind timeout (ms) for the natural follow-up observation. */
export const TIMEOUTS: Partial<Record<ActionKind, number>> = {
  [KIND.MCP_REQUEST]: 10_000,
  [KIND.WIDGET_RENDER]: 5_000,
  [KIND.WIDGET_DOM_CLICK]: 2_000,
  [KIND.WIDGET_DOM_INPUT]: 1_500,
  [KIND.WIDGET_DOM_CHANGE]: 1_500,
  [KIND.WIDGET_DOM_SUBMIT]: 3_000,
  [KIND.WIDGET_DOM_KEYDOWN]: 500,
  [KIND.WIDGET_INTENT]: 2_000,
};

export const DEFAULT_TIMEOUT = 1_000;

export function timeoutFor(kind: ActionKind): number {
  return TIMEOUTS[kind] ?? DEFAULT_TIMEOUT;
}
