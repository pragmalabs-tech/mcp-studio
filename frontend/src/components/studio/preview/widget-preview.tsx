import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { ChatShell } from "./chat-shell";
import { WidgetRenderer } from "./widget-renderer";

export function WidgetPreview({ widgetId }: { widgetId?: string } = {}) {
  const platform = useWidgetStore((s) => s.platform);
  const theme = useWidgetStore((s) => s.theme);
  const viewportPreset = useWidgetStore((s) => s.viewportPreset);
  const getViewportSize = useWidgetStore((s) => s.getViewportSize);
  const viewportSize = getViewportSize();

  return (
    <div className="flex-1 flex flex-col items-center min-h-0 p-3 bg-muted/20">
      <div
        className="flex-1 flex flex-col min-h-0 w-full"
        style={{ maxWidth: viewportSize.width }}
      >
        <ChatShell
          platform={platform}
          theme={theme}
          viewportPreset={viewportPreset}
          viewportWidth={viewportSize.width}
          viewportHeight={viewportSize.height}
        >
          <WidgetRenderer widgetId={widgetId} />
        </ChatShell>
      </div>
    </div>
  );
}
