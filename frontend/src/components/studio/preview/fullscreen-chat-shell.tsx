import type { Platform } from "@/lib/studio/stores/types";
import { getThemeColors, FakeChatInput } from "./shell-shared";

interface FullscreenChatShellProps {
  platform: Platform;
  theme: string;
  viewportPreset: string;
  viewportWidth: number;
  viewportHeight: number;
  children: React.ReactNode;
}

export function FullscreenChatShell({
  platform,
  theme,
  viewportPreset,
  viewportWidth,
  viewportHeight,
  children,
}: FullscreenChatShellProps) {
  const isDark = theme === "dark";
  const colors = getThemeColors(isDark);

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden rounded-lg relative"
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

      {/* Widget fills all remaining space with slight padding */}
      <div className="flex-1 overflow-hidden relative p-3">
        {children}

        {/* Chat input overlaid at the bottom */}
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
      </div>
    </div>
  );
}
