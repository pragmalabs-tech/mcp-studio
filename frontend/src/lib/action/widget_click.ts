import { Action } from "./types";
import type { StateChange, ToolState, WidgetState } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";

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
}

export class WidgetClickAction extends Action<{
  widgetId: string;
  candidates: string[];
  fallbackText?: string;
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

  constructor(widgetId: string, candidates: string[], fallbackText?: string) {
    super(
      "WIDGET_CLICK",
      fallbackText
        ? { widgetId, candidates, fallbackText }
        : { widgetId, candidates },
    );
    this.recorded = new Promise<void>((resolve) => {
      this._markRecorded = resolve;
    });
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
      setTimeout(resolve, 30_000);
    });
    if (useWidgetStore.getState().openClick === this) {
      useWidgetStore.setState({ openClick: null });
    }
    const snapshot = doc.documentElement.outerHTML;
    this.setResult(true, {
      matchedSelector: opts.matchedSelector,
      matchedIndex: opts.matchedIndex,
      snapshot,
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
    (el as HTMLElement).click();

    // Wait for external close. The 30s cap is a dev-safety net — orchestrators
    // (store.execute, runner) should close us well before that.
    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(resolve, 30_000);
    });

    if (useWidgetStore.getState().openClick === this) {
      useWidgetStore.setState({ openClick: null });
    }

    const snapshot = doc.documentElement.outerHTML;
    this.setResult(true, {
      matchedSelector,
      matchedIndex,
      snapshot,
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
