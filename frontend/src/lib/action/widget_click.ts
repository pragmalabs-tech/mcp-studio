import { Action } from "./types";
import type { StateChange, ToolState, WidgetState } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { describeFocus } from "./utils/describe-focus";
import { serializeIframeDocument } from "../../components/studio/preview/snapshot/snapshot";

/**
 * Outcome data carried on `action.result.data`.
 *   - `matchedSelector` — the first candidate that hit; null if none matched.
 *   - `matchedIndex` — 0-based index of the hit; diagnostic only, NOT asserted.
 *   - `snapshot` — DOM after settle; review artifact only, NOT asserted.
 *
 * The actual side effects (tools/call triggered by the widget, optional
 * widget/render if the response renders a new ui://) live in `action.events`
 * via the event bus; they are NOT duplicated here.
 */
export interface WidgetClickResult {
  matchedSelector: string | null;
  matchedIndex: number;
  snapshot: string | null;
  snapshotBounds?: { width: number; height: number };
  /** What held focus at the end of this step. A following text step reads this
   *  (via the forward `previous` context) to decide whether this click opened an
   *  editable editor worth re-opening. */
  endFocus?: { selector: string; editable: boolean };
}

/** Dispatch `count` clicks (with increasing `detail`) plus a trailing
 *  `dblclick` for count>=2, in the element's own realm. A single click keeps
 *  the native `el.click()` path. */
function dispatchClicks(doc: Document, el: HTMLElement, count: number): void {
  if (count <= 1) {
    el.click();
    return;
  }
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const M = win?.MouseEvent;
  if (!M) {
    el.click();
    return;
  }
  const base = { bubbles: true, cancelable: true, composed: true };
  for (let i = 1; i <= count; i++) {
    el.dispatchEvent(new M("click", { ...base, detail: i }));
  }
  el.dispatchEvent(new M("dblclick", { ...base, detail: 2 }));
}

export class WidgetClickAction extends Action<{
  widgetId: string;
  candidates: string[];
  fallbackText?: string;
  /** Click count: 1 = single, 2 = double, 3 = triple (browser `e.detail`). */
  detail: number;
}> {
  static assertablePoints: AssertablePoint[] = [
    {
      key: "success",
      label: "Click executed",
      path: "success",
      defaultMode: "exact",
      supportedModes: ["exact", "ignore"],
    },
    {
      key: "matched",
      label: "Element found",
      path: "data.matchedSelector",
      defaultMode: "exact",
      supportedModes: ["exact", "ignore"],
    },
    {
      key: "errorMessage",
      label: "Error message",
      path: "error.message",
      defaultMode: "exact",
      supportedModes: ["exact", "shape", "ignore"],
    },
  ];

  private _closeResolve?: () => void;
  private _markRecorded!: () => void;

  /** Resolves AFTER the orchestrator has handed this action to the recorder.
   *  Awaited by stop-record so the slice end-index includes this action even
   *  though `recorder.record(...)` runs in a microtask after close(). */
  readonly recorded: Promise<void>;

  constructor(
    widgetId: string,
    candidates: string[],
    fallbackText?: string,
    detail: number = 1,
  ) {
    super(
      "WIDGET_CLICK",
      fallbackText
        ? { widgetId, candidates, fallbackText, detail }
        : { widgetId, candidates, detail },
    );
    this.recorded = new Promise<void>((resolve) => {
      this._markRecorded = resolve;
    });
  }

  /** Raise the recorded click count (double/triple). Called by the segmenter
   *  when the browser reports a higher `e.detail` on the same target while
   *  this action's window is still open. */
  setDetail(detail: number): void {
    if (detail > this.data.detail) this.data.detail = detail;
  }

  /** Re-run this click against the live element, without touching the settle
   *  window or result. Used by a following text step to re-open an ephemeral
   *  editor that was destroyed between steps. Returns true if an element
   *  resolved and was clicked. */
  reopen(doc: Document): boolean {
    for (const sel of this.data.candidates) {
      const found = doc.querySelector(sel);
      if (found) {
        dispatchClicks(doc, found as HTMLElement, this.data.detail);
        return true;
      }
    }
    return false;
  }

  /** Resolves the open settle window. Idempotent. Called by store.execute()
   *  (next user action), recorder.stop() (end of slice), or the runner
   *  after expected events have arrived. */
  close(): void {
    const r = this._closeResolve;
    this._closeResolve = undefined;
    r?.();
  }

  /** Called by the orchestrator after `recorder.record(this)` has run.
   *  Resolves the `recorded` promise so stop-record can await this action. */
  markRecorded(): void {
    this._markRecorded();
  }

  /**
   * RECORDING entry point. The user has *already* clicked an element; the
   * iframe listener saw it and is constructing this action after the fact.
   * Skip the querySelector + dispatch (would re-fire the click) — just park
   * the settle window so downstream events (tools/call, widget/render)
   * route here via the bus. Resolves when `close()` is called by the
   * orchestrator (next user action or stop-record).
   */
  async recordFromUserClick(
    doc: Document,
    opts: { matchedSelector: string; matchedIndex: number },
  ): Promise<void> {
    useWidgetStore.setState({ openClick: this });
    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(resolve, 5_000);
    });
    if (useWidgetStore.getState().openClick === this) {
      useWidgetStore.setState({ openClick: null });
    }
    const snap = serializeIframeDocument(
      this.data.widgetId,
      useWidgetStore.getState()._iframeRef!,
    );
    this.setResult(true, {
      matchedSelector: opts.matchedSelector,
      matchedIndex: opts.matchedIndex,
      snapshot: snap?.html ?? null,
      snapshotBounds: snap?.bounds,
    } satisfies WidgetClickResult);
  }

  async execute(): Promise<void> {
    const store = useWidgetStore.getState();
    store.logAction("system", `Click widget ${this.data.widgetId}…`);
    const doc = store._iframeRef?.contentDocument;
    if (!doc) {
      this.setResult(false, undefined, { message: "iframe not mounted" });
      return;
    }

    let el: Element | null = null;
    let matchedSelector: string | null = null;
    let matchedIndex = -1;
    for (let i = 0; i < this.data.candidates.length; i++) {
      const found = doc.querySelector(this.data.candidates[i]);
      if (found) {
        el = found;
        matchedSelector = this.data.candidates[i];
        matchedIndex = i;
        break;
      }
    }
    if (!el) {
      this.setResult(false, undefined, { message: "element not found" });
      return;
    }

    useWidgetStore.setState({ openClick: this });
    dispatchClicks(doc, el as HTMLElement, this.data.detail);

    // Wait for external close. The 30s cap is a dev-safety net — orchestrators
    // (store.execute, runner) should close us well before that.
    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(resolve, 5_000);
    });

    if (useWidgetStore.getState().openClick === this) {
      useWidgetStore.setState({ openClick: null });
    }

    // Report what holds focus at step end so a following text step can tell
    // whether this click opened an editable editor worth re-opening.
    const endFocus = describeFocus(doc);
    const snap = serializeIframeDocument(
      this.data.widgetId,
      useWidgetStore.getState()._iframeRef!,
    );
    this.setResult(true, {
      matchedSelector,
      matchedIndex,
      snapshot: snap?.html ?? null,
      snapshotBounds: snap?.bounds,
      endFocus,
    } satisfies WidgetClickResult);
  }

  change(): StateChange {
    const tools: Record<string, ToolState> = {};
    const widgets: Record<string, WidgetState> = {
      [this.data.widgetId]: { renderCount: 0, clickCount: 1 },
    };
    let requestCount = 0;
    let responseCount = 0;
    let errorCount = 0;

    for (const e of this.events) {
      if (e.type === "tools/call") {
        const tool = (e.data as { tool: string }).tool;
        tools[tool] = {
          callCount: (tools[tool]?.callCount ?? 0) + 1,
        };
        requestCount++;
        if (e.result?.success) {
          responseCount++;
        } else {
          errorCount++;
        }
      } else if (e.type === "widget/render") {
        const wid = (e.data as { widgetId: string }).widgetId;
        const prev = widgets[wid] ?? { renderCount: 0, clickCount: 0 };
        widgets[wid] = {
          renderCount: prev.renderCount + 1,
          clickCount: prev.clickCount,
        };
      }
    }

    const change: StateChange = { widgets };
    if (requestCount > 0) {
      change.tools = tools;
      change.network = { requestCount, responseCount, errorCount };
    }
    return change;
  }
}
