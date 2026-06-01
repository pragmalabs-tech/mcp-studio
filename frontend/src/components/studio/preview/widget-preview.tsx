import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { ChatShell } from "./chat-shell";
import { WidgetRenderer } from "./widget-renderer";

export function WidgetPreview({ widgetId }: { widgetId?: string } = {}) {
  const platform = useWidgetStore((s) => s.platform);
  const viewportPreset = useWidgetStore((s) => s.viewportPreset);
  const getViewportSize = useWidgetStore((s) => s.getViewportSize);
  const viewportSize = getViewportSize();

  return (
    <ChatShell
      platform={platform}
      viewportPreset={viewportPreset}
      viewportWidth={viewportSize.width}
      viewportHeight={viewportSize.height}
    >
      <WidgetRenderer widgetId={widgetId} />
    </ChatShell>
  );
}
