import { serializeIframeDocument, type WidgetSnapshot } from "./snapshot";
export type { WidgetSnapshot };

export type WidgetId = string;

export function getWidgetIframe(widgetId: WidgetId): HTMLIFrameElement | null {
  return document.getElementById(
    `widget-iframe-${widgetId}`,
  ) as HTMLIFrameElement | null;
}

/** Synchronous snapshot of a widget's current iframe state. */
export function captureWidgetSnapshot(
  widgetId: WidgetId,
): WidgetSnapshot | null {
  const iframe = getWidgetIframe(widgetId);
  return iframe ? (serializeIframeDocument(widgetId, iframe) ?? null) : null;
}
