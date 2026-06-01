import type { Platform } from "@/lib/studio/stores/types";

function FakeUserMessage() {
  return (
    <div className="flex justify-end">
      <div className="bg-muted text-foreground rounded-3xl px-4 py-2.5 text-sm max-w-sm">
        Show me the result
      </div>
    </div>
  );
}

function FakeChatInput({ platform }: { platform: Platform }) {
  const isGpt = platform !== "claude";
  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <div className="max-w-2xl mx-auto rounded-2xl border bg-muted/50 overflow-hidden">
        <div className="px-4 pt-3 pb-2 text-sm text-muted-foreground/50 select-none">
          {isGpt ? "Message ChatGPT" : "Write a message…"}
        </div>
        <div className="flex items-center justify-between px-3 pb-3">
          <button
            disabled
            className="w-7 h-7 rounded-full border flex items-center justify-center text-muted-foreground/50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
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
          <div className="flex items-center gap-3 text-muted-foreground/40">
            <span className="text-[11px]">Sonnet 4.6</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ChatShellProps {
  platform: Platform;
  viewportPreset: string;
  viewportWidth: number;
  viewportHeight: number;
  children: React.ReactNode;
}

export function ChatShell({
  platform,
  viewportPreset,
  viewportWidth,
  viewportHeight,
  children,
}: ChatShellProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <span className="text-xs font-medium text-foreground">
          {platform === "claude" ? "Claude" : "ChatGPT"}
        </span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {viewportPreset === "custom"
            ? `${viewportWidth}×${viewportHeight}`
            : viewportPreset}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
          <FakeUserMessage />
          <div className="text-sm text-foreground">Let me show this:</div>
          {children}
        </div>
      </div>

      <FakeChatInput platform={platform} />
    </div>
  );
}
