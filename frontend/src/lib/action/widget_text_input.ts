import { Action } from "./types";
import type { StateChange, ToolState, WidgetState } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";
import { useStudioStore } from "@/lib/studio/store";

export interface WidgetTextInputResult {
  matchedSelector: string | null;
  matchedIndex: number;
  snapshot: string | null;
}

export class WidgetTextInputAction extends Action<{
  widgetId: string;
  candidates: string[];
  value: string;
  fallbackText?: string;
}> {
  static readonly DEBOUNCE_MS = 800;

  static assertablePoints: AssertablePoint[] = [
    {
      key: "success",
      label: "Input executed",
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
  private _debounceTimer?: ReturnType<typeof setTimeout>;
  /** Snapshot frozen synchronously before close() — used by recordFromUserInput
   *  to avoid capturing DOM changes made by the next element's event handlers. */
  private _frozenSnapshot?: string;

  /** Resolves AFTER the orchestrator has handed this action to the recorder. */
  readonly recorded: Promise<void>;

  constructor(
    widgetId: string,
    candidates: string[],
    value: string = "",
    fallbackText?: string,
  ) {
    super(
      "WIDGET_TEXT_INPUT",
      fallbackText
        ? { widgetId, candidates, value, fallbackText }
        : { widgetId, candidates, value },
    );
    this.recorded = new Promise<void>((resolve) => {
      this._markRecorded = resolve;
    });
  }

  /** Called by the iframe bridge on each `input` event during recording.
   *  Updates the accumulated value and resets the debounce timer. */
  updateValue(value: string): void {
    this.data.value = value;
    this._resetDebounce();
  }

  /** Capture the current iframe HTML into _frozenSnapshot if not already set.
   *  First caller wins — subsequent calls are no-ops. */
  private _captureSnapshot(): void {
    if (this._frozenSnapshot !== undefined) return;
    const doc = useStudioStore.getState()._iframeRef?.contentDocument;
    if (doc) this._frozenSnapshot = doc.documentElement.outerHTML;
  }

  private _resetDebounce(): void {
    if (this._debounceTimer !== undefined) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      // Case 2: debounce settled — capture snapshot now, before close().
      // At this point no new element has started typing, so the DOM reflects
      // only this action's typed value.
      this._captureSnapshot();
      this.close();
    }, WidgetTextInputAction.DEBOUNCE_MS);
  }

  /** Resolves the settle window. Idempotent. Called by the debounce timer,
   *  store.execute() (next user action), recorder.stop(), or the runner.
   *
   *  Case 1: close() is the snapshot gate — capturing here covers every
   *  caller (new element in onKeyup, store.execute, safety cap) without
   *  needing the caller to know about snapshot timing. */
  close(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    // Capture the snapshot at the moment of close if not already frozen.
    // When called from the debounce timer, _captureSnapshot() already ran so
    // this is a no-op. When called externally (new action, safety cap), this
    // is the actual capture — still correct because the caller closes us
    // before the next action mutates the DOM.
    this._captureSnapshot();
    const r = this._closeResolve;
    this._closeResolve = undefined;
    r?.();
  }

  markRecorded(): void {
    this._markRecorded();
  }

  /**
   * RECORDING entry point. The user has started typing in an element; the
   * iframe listener calls this once with the initial value, then calls
   * `updateValue()` on each subsequent input event. The settle window closes
   * automatically after DEBOUNCE_MS of silence, capturing any downstream
   * events (tools/call, widget/render) routed here via the bus.
   */
  async recordFromUserInput(
    doc: Document,
    opts: {
      matchedSelector: string;
      matchedIndex: number;
      initialValue: string;
    },
  ): Promise<void> {
    this.data.value = opts.initialValue;
    useStudioStore.setState({ openTextInput: this });

    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(() => this.close(), 30_000); // absolute safety cap
      this._resetDebounce();
    });

    if (useStudioStore.getState().openTextInput === this) {
      useStudioStore.setState({ openTextInput: null });
    }
    // _frozenSnapshot is always set by the time we reach here: close() calls
    // _captureSnapshot() as its first step, and every code path that resolves
    // this promise goes through close() (debounce timer, external close, safety cap).
    this.setResult(true, {
      matchedSelector: opts.matchedSelector,
      matchedIndex: opts.matchedIndex,
      snapshot: this._frozenSnapshot ?? null,
    } satisfies WidgetTextInputResult);
  }

  async execute(): Promise<void> {
    const store = useStudioStore.getState();
    store.logAction("system", `Text input widget ${this.data.widgetId}…`);
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

    useStudioStore.setState({ openTextInput: this });

    const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
    // React overloads the element's value setter, so a plain assignment is
    // silently ignored by the synthetic event system. Use the native prototype
    // setter to bypass React's wrapper, then dispatch both events so
    // controlled inputs (React, Vue, etc.) pick up the change.
    const proto =
      inputEl instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(inputEl, this.data.value);
    } else {
      inputEl.value = this.data.value;
    }
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(resolve, 30_000);
    });

    if (useStudioStore.getState().openTextInput === this) {
      useStudioStore.setState({ openTextInput: null });
    }

    this.setResult(true, {
      matchedSelector,
      matchedIndex,
      snapshot: this._frozenSnapshot ?? doc.documentElement.outerHTML,
    } satisfies WidgetTextInputResult);
  }

  change(): StateChange {
    const tools: Record<string, ToolState> = {};
    const widgets: Record<string, WidgetState> = {
      [this.data.widgetId]: { renderCount: 0, clickCount: 0, inputCount: 1 },
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
        const prev = widgets[wid] ?? {
          renderCount: 0,
          clickCount: 0,
          inputCount: 0,
        };
        widgets[wid] = {
          renderCount: prev.renderCount + 1,
          clickCount: prev.clickCount,
          inputCount: prev.inputCount ?? 0,
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
