import type { Platform } from "@/lib/studio/stores/types";

interface ThemeColors {
  bg: string;
  text: string;
  muted: string;
  border: string;
  inputBg: string;
}

function getThemeColors(isDark: boolean): ThemeColors {
  return isDark
    ? {
        bg: "#111111",
        text: "#e5e5e5",
        muted: "#737373",
        border: "rgba(255,255,255,0.1)",
        inputBg: "rgba(255,255,255,0.06)",
      }
    : {
        bg: "#ffffff",
        text: "#111111",
        muted: "#737373",
        border: "rgba(0,0,0,0.1)",
        inputBg: "rgba(0,0,0,0.04)",
      };
}

function FakeUserMessage({ colors }: { colors: ThemeColors }) {
  return (
    <div className="flex justify-end">
      <div
        className="rounded-3xl px-4 py-2.5 text-sm max-w-sm"
        style={{ backgroundColor: colors.inputBg, color: colors.text }}
      >
        Show me the result
      </div>
    </div>
  );
}

function FakeChatInput({
  platform,
  colors,
}: {
  platform: Platform;
  colors: ThemeColors;
}) {
  const isGpt = platform !== "claude";
  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <div
        className="max-w-2xl mx-auto flex items-center gap-2 px-3 py-2.5"
        style={{
          border: `1px solid ${colors.border}`,
          backgroundColor: colors.inputBg,
          borderRadius: 9999,
        }}
      >
        {/* + button */}
        <button
          disabled
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ color: colors.muted }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>

        {/* placeholder text */}
        <span
          className="flex-1 text-sm select-none truncate"
          style={{ color: colors.muted, opacity: 0.5 }}
        >
          {isGpt ? "Message ChatGPT" : "Write a message…"}
        </span>
      </div>
    </div>
  );
}

interface ChatShellProps {
  platform: Platform;
  theme: string;
  viewportPreset: string;
  viewportWidth: number;
  viewportHeight: number;
  children: React.ReactNode;
}

export function ChatShell({
  platform,
  theme,
  viewportPreset,
  viewportWidth,
  viewportHeight,
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

      {/* Messages */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
          <FakeUserMessage colors={colors} />
          <div className="text-sm" style={{ color: colors.text }}>
            Let me show this:
          </div>
          {children}
        </div>
      </div>

      <FakeChatInput platform={platform} colors={colors} />
    </div>
  );
}
