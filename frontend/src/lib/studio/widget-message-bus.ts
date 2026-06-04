import { useWidgetStore } from "./stores/widget-store";
import { callTool } from "./api";
import { recorder } from "../recorder/recorder";
import { eventBus } from "../event";
import { WidgetClickAction } from "../action/widget_click";
import { WidgetTextInputAction } from "../action/widget_text_input";

let started = false;

export function initWidgetMessageBus(): void {
  if (started) return;
  started = true;
  window.addEventListener("message", (e) => {
    void handleMessage(e);
  });
}

async function handleMessage(e: MessageEvent): Promise<void> {
  const data = e.data as Record<string, unknown> | null;
  if (!data) return;

  const store = useWidgetStore.getState();

  if (data.type === "studio_console") {
    store.addConsoleEntry(
      data.level as Parameters<typeof store.addConsoleEntry>[0],
      data.args as string[],
    );
    return;
  }

  if (
    data.type === "studio_content_height" &&
    typeof data.height === "number"
  ) {
    store.setAutoHeight(data.height);
    return;
  }

  if (data.type === "studio_action") {
    const method = data.method as string;
    const args = data.args;

    if (method === "callTool" && data.callId) {
      const iframe = store._iframeRef;
      const toolArgs = args as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const name = toolArgs?.name || "";
      const toolCallArgs = toolArgs?.arguments || {};
      store.logAction("callTool", { name, arguments: toolCallArgs });
      try {
        const result = await callTool(name, toolCallArgs);
        store.logAction("callTool:result", { name, result });
        iframe?.contentWindow?.postMessage(
          { type: "studio_tool_result", callId: data.callId, result },
          "*",
        );
      } catch (err) {
        store.logAction("callTool:error", {
          name,
          error: (err as Error).message,
        });
        iframe?.contentWindow?.postMessage(
          {
            type: "studio_tool_result",
            callId: data.callId,
            result: { error: (err as Error).message },
          },
          "*",
        );
      }
      return;
    }

    store.logAction(method, args);
    if (method === "sendFollowUpMessage") {
      store.addPendingMessage("openai", args);
    }
    if (method === "openExternal" && (args as { url?: string })?.url) {
      window.open(
        (args as { url: string }).url,
        "_blank",
        "noopener,noreferrer",
      );
    }
    return;
  }

  if (data.type === "studio_widget_click") {
    const targetId = store.activeWidgetId;
    if (!recorder.isCapturing() || !targetId) return;
    const candidates = data.candidates as string[];
    const fallbackText = data.fallbackText as string | undefined;
    if (!candidates?.length) return;
    const doc = store._iframeRef?.contentDocument ?? null;
    if (!doc) return;
    store.openClick?.close();
    store.openTextInput?.close();
    const action = new WidgetClickAction(targetId, candidates, fallbackText);
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

  if (data.type === "studio_widget_keyup") {
    const targetId = store.activeWidgetId;
    if (!recorder.isCapturing() || !targetId) return;
    const candidates = data.candidates as string[];
    const value = data.value as string;
    if (!candidates?.length) return;
    const openTextInput = store.openTextInput;
    if (openTextInput && openTextInput.data.candidates[0] === candidates[0]) {
      openTextInput.updateValue(value);
      return;
    }
    if (openTextInput) openTextInput.close();
    const doc = store._iframeRef?.contentDocument ?? null;
    if (!doc) return;
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
