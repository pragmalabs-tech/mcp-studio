import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { ChatShell } from "./chat-shell";
import { WidgetRenderer } from "./widget-renderer";

export function WidgetPreview({ widgetId }: { widgetId?: string } = {}) {
  const platform = useWidgetStore((s) => s.platform);
  const theme = useWidgetStore((s) => s.theme);
  const displayMode = useWidgetStore((s) => s.displayMode);
  const viewportPreset = useWidgetStore((s) => s.viewportPreset);
  const getViewportSize = useWidgetStore((s) => s.getViewportSize);
  const replaySizeLock = useWidgetStore((s) => s.replaySizeLock);
  const viewportSize = getViewportSize();

  const isFullscreen = displayMode === "fullscreen";
  const shellProps = {
    platform,
    theme,
    viewportPreset,
    viewportWidth: viewportSize.width,
    viewportHeight: viewportSize.height,
    isFullscreen,
  };

  return (
    <div className="flex-1 flex flex-col items-center min-h-0 p-3 bg-muted/20 overflow-auto">
      <div
        className={
          replaySizeLock
            ? "flex flex-col min-h-0 shrink-0"
            : "flex-1 flex flex-col min-h-0 w-full"
        }
        style={
          replaySizeLock
            ? { width: viewportSize.width }
            : { maxWidth: viewportSize.width }
        }
      >
        <ChatShell {...shellProps}>
          <WidgetRenderer
            widgetId={widgetId}
            fullscreen={isFullscreen}
            onExitFullscreen={
              isFullscreen
                ? () => useWidgetStore.getState().setDisplayMode("inline")
                : undefined
            }
          />
        </ChatShell>
      </div>
    </div>
  );
}
