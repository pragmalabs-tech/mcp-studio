import { Action } from "./types";
import type { StateChange, ToolState, WidgetState } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import type { CanvasLocator } from "./utils/widget-interaction-capture/types";
import { describeFocus } from "./utils/describe-focus";
import { waitUntil } from "@/lib/utils";

/**
 * Outcome data on `action.result.data`.
 *   - `matchedSelector` — how the canvas was resolved (selector / index / sole).
 *   - `nx`/`ny` — normalized tap position, echoed back for review.
 *   - `snapshot` — DOM after settle; review artifact only, NOT asserted.
 */
export interface WidgetCanvasClickResult {
  matchedSelector: string | null;
  nx: number;
  ny: number;
  snapshot: string | null;
  /** What held focus at the end of this step. A following text step reads this
   *  (via the forward `previous` context) to decide whether this click opened an
   *  editable editor worth re-opening. */
  endFocus?: { selector: string; editable: boolean };
}

/**
 * Locate the canvas: a unique selector wins; otherwise fall back to the Nth
 * canvas (guarded by `total`), then to the sole canvas if there's exactly one.
 * The index fallback is reliable because a widget renders its canvases in a
 * fixed order every run.
 */
function resolveCanvas(
  doc: Document,
  loc: CanvasLocator,
): { el: HTMLCanvasElement; selector: string } | null {
  try {
    const m = doc.querySelectorAll(loc.selector);
    if (m.length === 1) {
      return { el: m[0] as HTMLCanvasElement, selector: loc.selector };
    }
  } catch {
    /* invalid selector — fall through to index */
  }
  const all = doc.querySelectorAll("canvas");
  if (all.length === loc.total && loc.index >= 0 && loc.index < all.length) {
    return {
      el: all[loc.index] as HTMLCanvasElement,
      selector: `canvas#index=${loc.index}`,
    };
  }
  if (all.length === 1) {
    return { el: all[0] as HTMLCanvasElement, selector: "canvas" };
  }
  return null;
}

/**
 * Dispatch `count` taps (pointer + mirrored mouse) at normalized coords, with
 * increasing click `detail`, plus a trailing `dblclick` for count>=2. Events
 * are constructed in the iframe's own realm (`doc.defaultView`) so `instanceof`
 * checks inside the widget pass; `clientX/Y` are recomputed from the live rect
 * so position is independent of where/how big the canvas is now.
 */
function dispatchTaps(
  doc: Document,
  canvas: HTMLCanvasElement,
  nx: number,
  ny: number,
  count: number,
): void {
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + nx * rect.width;
  const clientY = rect.top + ny * rect.height;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) return;
  const P = win.PointerEvent;
  const M = win.MouseEvent;
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button: 0,
  };
  const taps = Math.max(1, count);
  for (let i = 1; i <= taps; i++) {
    if (P) {
      canvas.dispatchEvent(
        new P("pointerdown", {
          ...base,
          buttons: 1,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
    }
    if (M) canvas.dispatchEvent(new M("mousedown", { ...base, buttons: 1 }));
    if (P) {
      canvas.dispatchEvent(
        new P("pointerup", {
          ...base,
          buttons: 0,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
    }
    if (M) canvas.dispatchEvent(new M("mouseup", { ...base, buttons: 0 }));
    // A synthetic pointerup does NOT auto-generate a click — emit one with the
    // running click count for canvases that listen to `click` / read detail.
    if (M)
      canvas.dispatchEvent(new M("click", { ...base, buttons: 0, detail: i }));
  }
  if (taps >= 2 && M) {
    canvas.dispatchEvent(new M("dblclick", { ...base, buttons: 0, detail: 2 }));
  }
}

export class WidgetCanvasClickAction extends Action<{
  widgetId: string;
  canvas: CanvasLocator;
  nx: number;
  ny: number;
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
      label: "Canvas found",
      path: "data.matchedSelector",
      defaultMode: "warn",
      supportedModes: ["warn", "exact", "ignore"],
    },
    {
      key: "errorMessage",
      label: "Error message",
      path: "error.message",
      defaultMode: "warn",
      supportedModes: ["warn", "exact", "shape", "ignore"],
    },
  ];

  private _closeResolve?: () => void;
  private _markRecorded!: () => void;

  /** Resolves AFTER the orchestrator has handed this action to the recorder. */
  readonly recorded: Promise<void>;

  constructor(
    widgetId: string,
    canvas: CanvasLocator,
    nx: number,
    ny: number,
    detail: number = 1,
  ) {
    super("WIDGET_CANVAS_CLICK", { widgetId, canvas, nx, ny, detail });
    this.recorded = new Promise<void>((resolve) => {
      this._markRecorded = resolve;
    });
  }

  /** Raise the recorded click count (double/triple). Called by the segmenter
   *  when the browser reports a higher `e.detail` on the same canvas while
   *  this action's window is still open. */
  setDetail(detail: number): void {
    if (detail > this.data.detail) this.data.detail = detail;
  }

  /** Re-run this click's taps against the live canvas, without touching the
   *  settle window or result. Used by a following text step to re-open an
   *  ephemeral editor (e.g. Excalidraw's wysiwyg textarea) that was destroyed
   *  in the gap between steps, so the typing can happen while it's open.
   *  Returns true if the canvas resolved and taps were dispatched. */
  reopen(doc: Document): boolean {
    const resolved = resolveCanvas(doc, this.data.canvas);
    if (!resolved) return false;
    dispatchTaps(
      doc,
      resolved.el,
      this.data.nx,
      this.data.ny,
      this.data.detail,
    );
    return true;
  }

  /** Resolves the open settle window. Idempotent. */
  close(): void {
    const r = this._closeResolve;
    this._closeResolve = undefined;
    r?.();
  }

  markRecorded(): void {
    this._markRecorded();
  }

  /**
   * RECORDING entry point. The real tap already happened in the iframe — skip
   * dispatch and just park the settle window so downstream events route here.
   */
  async recordFromUserClick(doc: Document): Promise<void> {
    useWidgetStore.setState({ openClick: this });
    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(resolve, 30_000);
    });
    if (useWidgetStore.getState().openClick === this) {
      useWidgetStore.setState({ openClick: null });
    }
    const resolved = resolveCanvas(doc, this.data.canvas);
    this.setResult(true, {
      matchedSelector: resolved?.selector ?? this.data.canvas.selector,
      nx: this.data.nx,
      ny: this.data.ny,
      snapshot: doc.documentElement.outerHTML,
    } satisfies WidgetCanvasClickResult);
  }

  async execute(): Promise<void> {
    const store = useWidgetStore.getState();
    store.logAction("system", `Canvas click ${this.data.widgetId}…`);
    const doc = store._iframeRef?.contentDocument;
    if (!doc) {
      this.setResult(false, undefined, { message: "iframe not mounted" });
      return;
    }
    // Canvas may not be in the DOM yet if the widget is still rendering —
    // poll for up to 3s before giving up (matches step-by-step human delay).
    await waitUntil(() => resolveCanvas(doc, this.data.canvas) !== null, 3000);
    const resolved = resolveCanvas(doc, this.data.canvas);
    if (!resolved) {
      this.setResult(false, undefined, { message: "canvas not found" });
      return;
    }

    useWidgetStore.setState({ openClick: this });
    dispatchTaps(
      doc,
      resolved.el,
      this.data.nx,
      this.data.ny,
      this.data.detail,
    );

    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(resolve, 30_000);
    });
    if (useWidgetStore.getState().openClick === this) {
      useWidgetStore.setState({ openClick: null });
    }

    // Report what holds focus at step end so a following text step can tell
    // whether this click opened an editable editor worth re-opening.
    const endFocus = describeFocus(doc);

    this.setResult(true, {
      matchedSelector: resolved.selector,
      nx: this.data.nx,
      ny: this.data.ny,
      snapshot: doc.documentElement.outerHTML,
      endFocus,
    } satisfies WidgetCanvasClickResult);
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
        tools[tool] = { callCount: (tools[tool]?.callCount ?? 0) + 1 };
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
