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

export type WidgetInputKind = "click" | "keyup" | "canvas_click";

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

/**
 * Locator for a `<canvas>` element. A canvas has no meaningful inner elements,
 * so we identify it by its (combined-class) selector with an index fallback —
 * the count and order of canvases in a widget is stable across runs.
 */
export interface CanvasLocator {
  /** All-stable-class selector, or just "canvas". */
  selector: string;
  /** Nth `<canvas>` in document order. */
  index: number;
  /** Total canvas count — sanity check on replay before trusting `index`. */
  total: number;
}

export interface WidgetInputEvent {
  kind: WidgetInputKind;
  /** Present for "click" / "keyup". */
  target?: WidgetInputTarget;
  /** Present for "canvas_click". */
  canvas?: CanvasLocator;
  /** Canvas tap position, normalized 0..1 against the canvas bounding rect. */
  nx?: number;
  ny?: number;
  /** Pressed key for keyup events. */
  key?: string;
  /** Iframe `event.timeStamp` — kept for future gap-based segmentation. */
  ts?: number;
}
