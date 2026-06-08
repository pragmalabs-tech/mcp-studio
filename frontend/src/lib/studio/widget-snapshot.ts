import { useWidgetStore } from "./stores/widget-store";
import { eventBus, WidgetRenderEvent } from "../event";
import type { MockData } from "./mock-openai";
import { serializeIframeDocument } from "../../components/studio/preview/snapshot/snapshot";
import { getWidgetIframe } from "../../components/studio/preview/snapshot/snapshot-center";

export function scheduleWidgetSnapshot(
  targetId: string,
  mock: MockData,
  waitMs: number,
): () => void {
  const timer = setTimeout(() => {
    const iframe = getWidgetIframe(targetId);
    if (!iframe) return;
    const snap = serializeIframeDocument(targetId, iframe);
    useWidgetStore.getState().setSnapshot(targetId, snap ?? null);
    const meta = (mock?._meta ?? {}) as Record<string, unknown>;
    const ui = meta.ui as Record<string, unknown> | undefined;
    const uri =
      (typeof ui?.resourceUri === "string" && ui.resourceUri) ||
      (typeof ui?.uri === "string" && ui.uri) ||
      (typeof meta?.["openai/outputTemplate"] === "string" &&
        (meta["openai/outputTemplate"] as string)) ||
      targetId;
    eventBus.emit(new WidgetRenderEvent(targetId, uri, { success: true }));
  }, waitMs);

  return () => clearTimeout(timer);
}
