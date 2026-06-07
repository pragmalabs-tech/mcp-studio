import { serializeDoc } from "./serialize-doc";

export function takeWidgetSnapshot(iframe: HTMLIFrameElement): string | null {
  const doc = iframe.contentDocument;
  if (!doc) return null;
  return serializeDoc(doc);
}
