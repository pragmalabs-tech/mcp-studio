import { useEffect, useRef } from "react";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { createClaudeMock } from "@/lib/studio/mock-claude";
import { callTool } from "@/lib/studio/api";
import { getWidgetColors } from "@/lib/core/widget/colors";
import { scheduleWidgetSnapshot } from "@/lib/studio/widget-snapshot";
import { useProfileStore } from "@/lib/studio/stores/profile-store";

export function WidgetRenderer({
  widgetId,
  fullscreen,
  onExitFullscreen,
}: {
  widgetId?: string;
  fullscreen?: boolean;
  onExitFullscreen?: () => void;
} = {}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastWrittenRef = useRef<{
    targetId: string;
    injectedHtml: string;
    replayEpoch: number;
  } | null>(null);

  const activeWidgetId = useWidgetStore((s) => s.activeWidgetId);
  const targetId = widgetId ?? activeWidgetId;
  const entry = useWidgetStore((s) =>
    targetId ? (s.widgets[targetId] ?? null) : null,
  );
  const injectedHtml = entry?.injectedHtml ?? null;
  const platform = useWidgetStore((s) => s.platform);
  const logAction = useWidgetStore((s) => s.logAction);
  const addPendingMessage = useWidgetStore((s) => s.addPendingMessage);
  const getViewportSize = useWidgetStore((s) => s.getViewportSize);
  const autoHeight = useWidgetStore((s) => s.autoHeight);
  const replaySizeLock = useWidgetStore((s) => s.replaySizeLock);
  const replayEpoch = useWidgetStore((s) => s.replayEpoch);
  const profileName = useProfileStore((s) => {
    const profile = s.profiles.find((p) => p.id === s.activeProfileId);
    return profile?.name ?? null;
  });
  const theme = useWidgetStore((s) => s.theme);

  const setIframe = (el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
    useWidgetStore.setState({ _iframeRef: el });
  };

  // Pure write effect — writes injectedHtml to the iframe whenever it changes.
  // Also recreates the ext-apps mock so it's always in sync with the current HTML.
  useEffect(() => {
    if (!targetId || !injectedHtml || !entry) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    // Skip re-write if this exact content is already live in the iframe.
    // replayEpoch is included so each new replay run forces a full re-injection
    // even when injectedHtml is identical — otherwise the old widget instance
    // keeps running with its previous internal state (edit mode, scroll, etc.).
    if (
      lastWrittenRef.current?.targetId === targetId &&
      lastWrittenRef.current?.injectedHtml === injectedHtml &&
      lastWrittenRef.current?.replayEpoch === replayEpoch
    ) {
      useWidgetStore.getState()._extAppsMock?.update(entry.mock);
      return;
    }
    lastWrittenRef.current = { targetId, injectedHtml, replayEpoch };

    // Reset to inline so the new widget starts from a clean display state.
    // Pass displayMode:"inline" into the mock so the host-context sent during
    // initialization also says "inline" — otherwise the widget reads its
    // recorded displayMode from hostContext and immediately re-requests it,
    // undoing the reset. The widget can still call requestDisplayMode itself.
    useWidgetStore.setState({ displayMode: "inline" });

    const prev = useWidgetStore.getState()._extAppsMock;
    if (prev) {
      prev.destroy();
      useWidgetStore.setState({ _extAppsMock: null });
    }
    const extAppsMock = createClaudeMock(
      iframe,
      { ...entry.mock, displayMode: "inline" },
      (method, args) => logAction(method, args),
      (name, args) => callTool(name, args),
      platform === "claude"
        ? (content) => addPendingMessage("claude", content)
        : undefined,
      (mode) => useWidgetStore.setState({ displayMode: mode }),
    );
    useWidgetStore.setState({ _extAppsMock: extAppsMock });

    doc.open();
    doc.write(injectedHtml);
    doc.close();

    return scheduleWidgetSnapshot(targetId, doc, entry.mock, entry.waitMs);
  }, [
    targetId,
    injectedHtml,
    entry,
    platform,
    logAction,
    addPendingMessage,
    replayEpoch,
  ]);

  // Destroy the mock when this component unmounts.
  useEffect(() => {
    return () => {
      useWidgetStore.getState()._extAppsMock?.destroy();
      useWidgetStore.setState({ _extAppsMock: null });
    };
  }, []);

  const viewportSize = getViewportSize();
  const widgetColors = getWidgetColors(platform);
  // While locked for replay, force the exact recorded height (ignore autoHeight)
  // so the canvas size — and thus tap mapping — matches the recording.
  const displayHeight = replaySizeLock
    ? viewportSize.height
    : autoHeight
      ? Math.min(autoHeight, viewportSize.height)
      : viewportSize.height;

  const isDark = theme === "dark";
  const headerBg = isDark ? "#1a1a1a" : "#f5f5f5";
  const headerBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const headerText = isDark ? "#e5e5e5" : "#111111";
  const avatarLetter = profileName ? profileName[0].toUpperCase() : "A";

  const meta = (entry?.mock?._meta ?? {}) as Record<string, unknown>;
  const ui = meta.ui as Record<string, unknown> | undefined;
  const showBorder = ui?.prefersBorder === true;

  return (
    <div
      style={
        fullscreen
          ? {
              width: "100%",
              height: "100%",
              backgroundColor: widgetColors.background,
              border: showBorder ? `1px solid ${headerBorder}` : undefined,
              borderRadius: "0.5rem",
              overflow: "hidden",
            }
          : {
              width: viewportSize.width,
              height: displayHeight,
              maxWidth: "100%",
              backgroundColor: widgetColors.background,
              border: showBorder ? `1px solid ${headerBorder}` : undefined,
              borderRadius: "0.5rem",
              overflow: "hidden",
            }
      }
      className={fullscreen ? "" : "shrink-0"}
    >
      {/* App header */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{
          backgroundColor: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
        }}
      >
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-semibold shrink-0"
          style={{
            backgroundColor: isDark ? "#333333" : "#d4d4d4",
            color: headerText,
          }}
        >
          {avatarLetter}
        </div>
        <span
          className="text-xs font-medium truncate flex-1"
          style={{ color: headerText }}
        >
          {profileName ?? "App"}
        </span>
        {fullscreen && onExitFullscreen && (
          <button
            onClick={onExitFullscreen}
            className="flex items-center justify-center w-5 h-5 rounded hover:opacity-60 transition-opacity shrink-0"
            style={{ color: headerText }}
            title="Exit fullscreen"
          >
            ✕
          </button>
        )}
      </div>
      <iframe
        ref={setIframe}
        style={{ height: fullscreen ? "100%" : viewportSize.height }}
        className={fullscreen ? "w-full h-full block" : "w-full block"}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
        title="Widget Preview"
      />
    </div>
  );
}
