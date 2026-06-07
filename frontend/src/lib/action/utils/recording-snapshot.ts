import { serializeDoc } from "./snapshot/serialize-doc";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";

export interface RecordingSnap {
  /** Capture immediately, cancelling any pending timer. Idempotent. */
  captureNow(): void;
  /** The captured HTML, or null if not yet captured. */
  readonly value: string | null;
}

/**
 * Schedule a recording snapshot for an action.
 *
 * Three capture paths — whichever fires first wins (first-caller wins):
 *   1. Widget re-render detected: Zustand notifies subscribers synchronously
 *      when `insertWidget` calls `set()`, before React's useEffect rewrites
 *      the iframe. We capture here so the snapshot shows the pre-re-render DOM.
 *   2. After `delayMs` (default 150ms — mirrors replay's DOM-rerender grace),
 *      if no re-render happened.
 *   3. Immediately via `captureNow()` — called when the next action arrives
 *      (inside the wrapped `_closeResolve`).
 *
 * Pass no `delayMs` to skip the automatic timer (e.g. text-input debounce).
 */
export function scheduleRecordingSnapshot(
  doc: Document,
  delayMs?: number,
): RecordingSnap {
  let _value: string | null = null;
  const capture = () => {
    if (_value === null) _value = serializeDoc(doc);
  };

  const timer =
    delayMs !== undefined ? setTimeout(capture, delayMs) : undefined;

  // Path 1: capture before the widget iframe is rewritten.
  // insertWidget() calls set() which notifies Zustand subscribers
  // synchronously — React's useEffect (doc.open / doc.write) runs later.
  const activeId = useWidgetStore.getState().activeWidgetId;
  const initialHtml = activeId
    ? useWidgetStore.getState().widgets[activeId]?.injectedHtml
    : undefined;

  let unsubscribe: (() => void) | undefined;
  unsubscribe = useWidgetStore.subscribe((state) => {
    if (!activeId) return;
    if (state.widgets[activeId]?.injectedHtml !== initialHtml) {
      capture();
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
    }
  });

  return {
    captureNow() {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
      capture();
    },
    get value() {
      return _value;
    },
  };
}
