import type { Platform } from "@/lib/studio/stores/types";
import { getThemeColors, FakeUserMessage, FakeChatInput } from "./shell-shared";

interface ChatShellProps {
  platform: Platform;
  theme: string;
  viewportPreset: string;
  viewportWidth: number;
  viewportHeight: number;
  isFullscreen?: boolean;
  children: React.ReactNode;
}

export function ChatShell({
  platform,
  theme,
  viewportPreset,
  viewportWidth,
  viewportHeight,
  isFullscreen,
  children,
}: ChatShellProps) {
  const isDark = theme === "dark";
  const colors = getThemeColors(isDark);

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden rounded-lg"
      style={{
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${colors.border}` }}
      >
        <span className="text-xs font-medium" style={{ color: colors.text }}>
          {platform === "claude" ? "Claude" : "ChatGPT"}
        </span>
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: colors.muted }}
        >
          {viewportPreset === "custom"
            ? `${viewportWidth}×${viewportHeight}`
            : viewportPreset}
        </span>
      </div>

      {/* Pre-widget messages — always in tree, hidden in fullscreen to keep children position stable */}
      <div className={isFullscreen ? "hidden" : "overflow-auto"}>
        <div className="w-full px-16 py-6 flex flex-col gap-4">
          <FakeUserMessage colors={colors} />
          <div className="text-sm" style={{ color: colors.text }}>
            Let me show this:
          </div>
        </div>
      </div>

      {/* Widget container — always at the same position in the tree */}
      <div
        className={
          isFullscreen ? "flex-1 overflow-hidden relative p-3" : "px-16 pb-6"
        }
      >
        {children}
        {isFullscreen && (
          <div
            className="absolute bottom-0 left-0 right-0 z-10"
            style={{
              background: isDark
                ? "linear-gradient(to top, rgba(17,17,17,0.95) 60%, transparent)"
                : "linear-gradient(to top, rgba(255,255,255,0.95) 60%, transparent)",
            }}
          >
            <FakeChatInput platform={platform} colors={colors} />
          </div>
        )}
      </div>

      {!isFullscreen && <FakeChatInput platform={platform} colors={colors} />}
    </div>
  );
}
