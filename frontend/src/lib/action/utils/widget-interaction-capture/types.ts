/**
 * Raw input events forwarded by the in-iframe sensor (`capture-events.ts`).
 *
 * The sensor is deliberately "dumb": it serializes each interaction into one
 * of these and posts it to the host. It does NOT decide what the interaction
 * *means* (click action vs. text input vs. nothing) — that policy lives in the
 * host segmenter (`segmenter.ts`), which folds the event stream into Actions.
 *
 * Selector candidates are computed in the iframe because they need the live
 * target element at event time; everything else here is plain serializable
 * fact about the target and the event.
 */

export type WidgetInputKind = "click" | "keyup";

export interface WidgetInputTarget {
  /** Ranked, uniqueness-filtered CSS selectors for the event target. */
  candidates: string[];
  /** Lowercased tag name, e.g. "button", "input". */
  tag?: string;
  /** Control type when present (input's `type`, etc.). */
  type?: string;
  /** True for text inputs / textareas — the host routes these to text input. */
  isTextLike: boolean;
  /** Trimmed textContent (≤40 chars). Used as the click action's fallback. */
  text?: string;
  /** Current value for text-like targets. */
  value?: string;
}

export interface WidgetInputEvent {
  kind: WidgetInputKind;
  target: WidgetInputTarget;
  /** Pressed key for keyup events. */
  key?: string;
  /** Iframe `event.timeStamp` — kept for future gap-based segmentation. */
  ts?: number;
}
