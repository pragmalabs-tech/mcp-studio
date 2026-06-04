import { useWidgetStore } from "./stores/widget-store";
import { callTool } from "./api";
import { handleWidgetInput } from "@/lib/action/utils/widget-interaction-capture/segmenter";
import type { WidgetInputEvent } from "@/lib/action/utils/widget-interaction-capture/types";

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

  if (data.type === "studio_input") {
    handleWidgetInput({
      kind: data.kind,
      target: data.target,
      key: data.key,
      ts: typeof data.ts === "number" ? data.ts : undefined,
    } as WidgetInputEvent);
    return;
  }
}
