import { Action } from "./types";
import type { ExecuteContext } from "./types";
import type { StateChange, ToolState, WidgetState } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { WidgetCanvasClickAction } from "./widget_canvas_click";
import { WidgetClickAction } from "./widget_click";
import { serializeDoc } from "./utils/serialize-doc";

export interface WidgetTextInputResult {
  matchedSelector: string | null;
  matchedIndex: number;
  snapshot: string | null;
  /** Whether the iframe actually acted on the input — our proof the event was
   *  consumed, not just dispatched into the void:
   *   - matched field: the field's value reads back as the value we set;
   *   - fallback keystrokes: a handler inside the iframe called
   *     `preventDefault()` (so `dispatchEvent` reported the event as handled).
   *  `null` when we couldn't determine it (e.g. nothing was dispatched). */
  applied: boolean | null;
}

/** Fallback for widgets that manage text themselves (e.g. canvas/app widgets
 *  that listen for keystrokes at the document level) instead of exposing a
 *  targetable field. Drives those handlers by dispatching a realm-correct key
 *  sequence per character at the document root: events are built from the
 *  iframe's own `KeyboardEvent` (`doc.defaultView`) so `instanceof` checks
 *  inside the widget pass, and `bubbles`+`composed` let them reach any
 *  document/window listener and cross shadow-DOM boundaries. */
interface FallbackDispatch {
  /** Tag the keystrokes were dispatched at (e.g. "html", "body", "textarea"). */
  targetTag: string;
  /** Number of characters dispatched. */
  chars: number;
  /** Whether a listener called `preventDefault()` (the iframe reacted). */
  handled: boolean;
  /** How many `input`/`beforeinput` events the app produced from our keys.
   *  Synthetic keys never produce these on their own, so >0 means the app
   *  turned keystrokes into real text input (canvas app / contenteditable). */
  inputEvents: number;
}

function dispatchTextAsKeys(doc: Document, value: string): FallbackDispatch {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  const K = win?.KeyboardEvent;
  const target = doc.activeElement ?? doc.documentElement;
  if (!K || !target) {
    return { targetTag: "", chars: 0, handled: false, inputEvents: 0 };
  }
  let inputEvents = 0;
  const onInput = () => {
    inputEvents++;
  };
  doc.addEventListener("input", onInput, true);
  doc.addEventListener("beforeinput", onInput, true);

  const base = { bubbles: true, cancelable: true, composed: true };
  let handled = false;
  for (const ch of value) {
    // dispatchEvent returns false when a listener called preventDefault().
    if (!target.dispatchEvent(new K("keydown", { ...base, key: ch })))
      handled = true;
    if (!target.dispatchEvent(new K("keypress", { ...base, key: ch })))
      handled = true;
    target.dispatchEvent(new K("keyup", { ...base, key: ch }));
  }

  doc.removeEventListener("input", onInput, true);
  doc.removeEventListener("beforeinput", onInput, true);
  return {
    targetTag: target.tagName?.toLowerCase() ?? "",
    chars: value.length,
    handled,
    inputEvents,
  };
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
      key: "applied",
      label: "Input applied by widget",
      path: "data.applied",
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
    const doc = useWidgetStore.getState()._iframeRef?.contentDocument;
    if (doc) this._frozenSnapshot = serializeDoc(doc);
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
    useWidgetStore.setState({ openTextInput: this });

    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(() => this.close(), 30_000); // absolute safety cap
      this._resetDebounce();
    });

    if (useWidgetStore.getState().openTextInput === this) {
      useWidgetStore.setState({ openTextInput: null });
    }
    // _frozenSnapshot is always set by the time we reach here: close() calls
    // _captureSnapshot() as its first step, and every code path that resolves
    // this promise goes through close() (debounce timer, external close, safety cap).
    this.setResult(true, {
      matchedSelector: opts.matchedSelector,
      matchedIndex: opts.matchedIndex,
      snapshot: this._frozenSnapshot ?? null,
      applied: true, // recorded from a real user keystroke — definitionally applied
    } satisfies WidgetTextInputResult);
  }

  /** First candidate selector that resolves against the live document. */
  private _findCandidate(
    doc: Document,
  ): { el: Element; selector: string; index: number } | null {
    for (let i = 0; i < this.data.candidates.length; i++) {
      const found = doc.querySelector(this.data.candidates[i]);
      if (found)
        return { el: found, selector: this.data.candidates[i], index: i };
    }
    return null;
  }

  /** Set the field's value the way a controlled component expects (native
   *  prototype setter to bypass React's wrapper + input/change events), read it
   *  back to confirm acceptance, and optionally commit (Escape) for editors
   *  that only persist on blur/commit. Returns whether the value stuck. */
  private _applyToField(
    doc: Document,
    inputEl: HTMLInputElement | HTMLTextAreaElement,
    opts: { commit: boolean },
  ): boolean {
    // Re-focus the field first. Some editors only accept input while focused
    // (an element can be present but blurred between steps); focusing is also
    // what a real user does before typing. Harmless for ordinary inputs.
    try {
      (inputEl as HTMLElement).focus();
    } catch {
      /* focus() can throw on detached/odd elements — ignore and continue */
    }

    // CRITICAL: operate in the IFRAME's realm, not the host's. The element's
    // value-tracker (installed by the widget's own framework, e.g. React inside
    // the iframe) lives on the *iframe's* HTMLTextAreaElement.prototype. Using
    // the host's prototype setter sets the DOM value but leaves the iframe
    // framework's tracker thinking nothing changed — so a controlled editor
    // (Excalidraw) reads the OLD value on commit and nothing appears. Grabbing
    // the iframe-realm setter is what makes the change actually register.
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    const TA = win?.HTMLTextAreaElement ?? HTMLTextAreaElement;
    const IN = win?.HTMLInputElement ?? HTMLInputElement;
    const proto = inputEl instanceof TA ? TA.prototype : IN.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(inputEl, this.data.value);
    } else {
      inputEl.value = this.data.value;
    }
    // Realm-correct input/change so the widget's listeners (and any
    // `instanceof InputEvent` checks) treat them as native.
    const Ev = (win?.Event ?? Event) as typeof Event;
    const InputEvt = (win?.InputEvent ?? Ev) as typeof Event;
    inputEl.dispatchEvent(new InputEvt("input", { bubbles: true }));
    inputEl.dispatchEvent(new Ev("change", { bubbles: true }));
    const applied = inputEl.value === this.data.value;
    if (opts.commit) {
      // Persist editors that commit on a key, not just blur (e.g. Excalidraw
      // finishes editing on Escape OR Cmd/Ctrl+Enter — its on-canvas hint says
      // so). Send both bindings; whichever the build honors commits the text.
      const K = win?.KeyboardEvent;
      if (K) {
        const base = { bubbles: true, cancelable: true, composed: true };
        inputEl.dispatchEvent(
          new K("keydown", {
            ...base,
            key: "Enter",
            code: "Enter",
            ctrlKey: true,
            metaKey: true,
          }),
        );
        inputEl.dispatchEvent(
          new K("keyup", {
            ...base,
            key: "Enter",
            code: "Enter",
            ctrlKey: true,
            metaKey: true,
          }),
        );
        inputEl.dispatchEvent(
          new K("keydown", { ...base, key: "Escape", code: "Escape" }),
        );
        inputEl.dispatchEvent(
          new K("keyup", { ...base, key: "Escape", code: "Escape" }),
        );
      }
    }
    return applied;
  }

  async execute(ctx?: ExecuteContext): Promise<void> {
    const store = useWidgetStore.getState();
    store.logAction("system", `Text input widget ${this.data.widgetId}…`);
    const doc = store._iframeRef?.contentDocument;
    if (!doc) {
      this.setResult(false, undefined, { message: "iframe not mounted" });
      return;
    }

    let match = this._findCandidate(doc);

    // Self-heal: the target may belong to an ephemeral editor that was destroyed
    // in the gap between steps (e.g. Excalidraw's wysiwyg textarea commits and
    // removes itself on blur). If the previous step was the click that opened
    // it, replay that click to re-open the editor and type now — in THIS step,
    // while it's open — instead of dispatching into the void.
    let reopened = false;
    if (!match) {
      const prev = ctx?.previous;
      // Only re-open if the previous step actually left an editable element
      // focused — i.e. it opened an editor (your "return focus from the prev
      // step" idea, used here as the gate). Avoids spurious re-clicks after a
      // plain navigation/click that opened nothing.
      const prevEndFocus = (
        prev?.result?.data as { endFocus?: { editable: boolean } } | undefined
      )?.endFocus;
      if (
        (prev instanceof WidgetCanvasClickAction ||
          prev instanceof WidgetClickAction) &&
        prevEndFocus?.editable === true
      ) {
        reopened = prev.reopen(doc);
        if (reopened) {
          match = this._findCandidate(doc);
          store.logAction(
            "system",
            `Text input ${this.data.widgetId}: re-opened editor via previous step; candidate ${match ? "found" : "still missing"}.`,
          );
        }
      }
    }

    const el: Element | null = match?.el ?? null;
    const matchedSelector: string | null = match?.selector ?? null;
    const matchedIndex = match?.index ?? -1;

    // No field matched. The widget may manage text itself (canvas/app widgets
    // that listen at the document level), so fall back to driving its keyboard
    // handlers instead of failing outright. `matchedSelector` stays null so the
    // `matched` assertion still reflects that no selector hit. Only hard-fail if
    // we can't even reach the iframe realm to dispatch.
    if (!el && !doc.defaultView) {
      this.setResult(false, undefined, { message: "element not found" });
      return;
    }

    useWidgetStore.setState({ openTextInput: this });

    // Whether the iframe actually took the input. Proven by value read-back on
    // the matched path, or by preventDefault() on the fallback path. Kept null
    // only if we somehow dispatched nothing.
    let applied: boolean | null = null;

    if (el) {
      applied = this._applyToField(
        doc,
        el as HTMLInputElement | HTMLTextAreaElement,
        { commit: reopened },
      );
      store.logAction(
        "system",
        `Text input → ${matchedSelector} (candidate #${matchedIndex})` +
          `${reopened ? " [re-opened editor]" : ""}; ` +
          `widget ${applied ? "accepted" : "did NOT accept"} the value.`,
      );
    } else {
      // Fallback path: no field matched, so drive the widget's own keyboard
      // handlers. `inputEvents` is the decisive signal — synthetic keys never
      // produce input/beforeinput on their own, so any count means the app
      // turned our keystrokes into real text (canvas-style). preventDefault
      // alone only proves the keys were consumed (possibly as a shortcut).
      const info = dispatchTextAsKeys(doc, this.data.value);
      if (info.inputEvents > 0) applied = true;
      else if (info.handled) applied = null;
      else applied = false;
      store.logAction(
        "system",
        `Text input fallback: no candidate matched; dispatched ${info.chars} ` +
          `key(s) at <${info.targetTag || "?"}>; inputEvents=${info.inputEvents}, ` +
          `handled=${info.handled} → applied=${applied}.`,
      );
    }

    await new Promise<void>((resolve) => {
      this._closeResolve = resolve;
      setTimeout(resolve, 30_000);
    });

    if (useWidgetStore.getState().openTextInput === this) {
      useWidgetStore.setState({ openTextInput: null });
    }

    this.setResult(true, {
      matchedSelector,
      matchedIndex,
      snapshot: this._frozenSnapshot ?? serializeDoc(doc),
      applied,
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
