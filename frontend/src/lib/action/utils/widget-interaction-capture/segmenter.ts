/**
 * Host-side input segmenter — the "interpreter" half of the sensor/interpreter
 * split. The iframe sensor forwards raw `WidgetInputEvent`s; this module
 * decides which of them become recorded Actions and drives each Action's
 * open-window (settle window + event-bus attribution).
 *
 * All the policy that used to be inlined in `widget-message-bus.ts` lives here
 * so it can be unit-tested without an iframe or postMessage.
 */
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { recorder } from "@/lib/recorder/recorder";
import { eventBus } from "@/lib/event";
import { WidgetClickAction } from "@/lib/action/widget_click";
import { WidgetTextInputAction } from "@/lib/action/widget_text_input";
import { WidgetCanvasClickAction } from "@/lib/action/widget_canvas_click";
import type { WidgetInputEvent } from "./types";

/** Keys that mutate a text field's value — the only keyups worth recording. */
function isEditingKey(key: string | undefined): boolean {
  return !!key && (key.length === 1 || key === "Backspace" || key === "Delete");
}

/**
 * Fold one raw input event into the recording. Gated on `recorder.isCapturing()`
 * and an active widget, exactly as before. Click → `WidgetClickAction`;
 * editing keyup on a text field → `WidgetTextInputAction` (debounced via the
 * action's own open-window, coalescing successive keystrokes into one action).
 */
export function handleWidgetInput(evt: WidgetInputEvent): void {
  const store = useWidgetStore.getState();
  const targetId = store.activeWidgetId;
  if (!recorder.isCapturing() || !targetId) return;

  const doc = store._iframeRef?.contentDocument ?? null;
  if (!doc) return;

  if (evt.kind === "canvas_click" && evt.canvas) {
    const detail = evt.detail ?? 1;
    // Double/triple-click: the browser increments `detail` on successive clicks
    // of the same target. Fold the higher-detail click into the still-open
    // action instead of recording a second one.
    const open = store.openClick;
    if (
      detail > 1 &&
      open instanceof WidgetCanvasClickAction &&
      open.data.canvas.selector === evt.canvas.selector
    ) {
      open.setDetail(detail);
      return;
    }
    store.openClick?.close();
    store.openTextInput?.close();
    const action = new WidgetCanvasClickAction(
      targetId,
      evt.canvas,
      evt.nx ?? 0,
      evt.ny ?? 0,
      detail,
    );
    eventBus.setActive(action);
    void action.recordFromUserClick(doc).then(() => {
      if (eventBus.current() === action) eventBus.setActive(null);
      recorder.record(action, { stateChange: action.change() });
      action.markRecorded();
    });
    return;
  }

  const candidates = evt.target?.candidates;
  if (!candidates?.length || !evt.target) return;

  if (evt.kind === "click" && !evt.target.isTextLike) {
    const detail = evt.detail ?? 1;
    // Same fold for DOM clicks: a higher-detail click on the same element
    // upgrades the open action to a double/triple-click.
    const open = store.openClick;
    if (
      detail > 1 &&
      open instanceof WidgetClickAction &&
      open.data.candidates[0] === candidates[0]
    ) {
      open.setDetail(detail);
      return;
    }
    store.openClick?.close();
    store.openTextInput?.close();
    const action = new WidgetClickAction(
      targetId,
      candidates,
      evt.target.text,
      detail,
    );
    eventBus.setActive(action);
    void action
      .recordFromUserClick(doc, {
        matchedSelector: candidates[0],
        matchedIndex: 0,
      })
      .then(() => {
        if (eventBus.current() === action) eventBus.setActive(null);
        recorder.record(action, { stateChange: action.change() });
        action.markRecorded();
      });
    return;
  }

  if (evt.kind === "keyup" && evt.target.isTextLike) {
    if (!isEditingKey(evt.key)) return;
    // A keystroke means any pending click is finished — finalize it now so
    // actions record in interaction order, not in settle-close order.
    store.openClick?.close();
    const value = evt.target.value ?? "";
    const openTextInput = store.openTextInput;
    if (openTextInput && openTextInput.data.candidates[0] === candidates[0]) {
      openTextInput.updateValue(value);
      return;
    }
    if (openTextInput) openTextInput.close();
    const action = new WidgetTextInputAction(targetId, candidates, value);
    eventBus.setActive(action);
    void action
      .recordFromUserInput(doc, {
        matchedSelector: candidates[0],
        matchedIndex: 0,
        initialValue: value,
      })
      .then(() => {
        if (eventBus.current() === action) eventBus.setActive(null);
        recorder.record(action, { stateChange: action.change() });
        action.markRecorded();
      });
    return;
  }
}
