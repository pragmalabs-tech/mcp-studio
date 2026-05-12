import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudioStore, type CspViolation } from "@/lib/studio/store";
import { VIEWPORT_PRESETS } from "@/lib/studio/store";
import { callTool, getBaseUrl } from "@/lib/studio/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WidgetFrame } from "@/lib/core/views/widget-frame";
import { createExtAppsMock } from "@/lib/studio/mock-claude";
import { recorder } from "@/lib/recorder/bus";
import { dbg } from "@/lib/recorder/debug";
import RECORDER_BRIDGE_SOURCE from "@/widget-bridge/recorder-bridge.js?raw";

/** SVG icons for chat chrome */
const icons = {
  hamburger: (color: string) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  chevronDown: (color: string) => (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  compose: (color: string) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  plus: (color: string) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  mic: (color: string) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
    </svg>
  ),
  send: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
    </svg>
  ),
  dots: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={color}>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  ),
  share: (color: string) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
  mcpIcon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="3"
        width="7"
        height="7"
        rx="1.5"
        stroke="#10a37f"
        strokeWidth="2"
      />
      <rect
        x="14"
        y="3"
        width="7"
        height="7"
        rx="1.5"
        stroke="#10a37f"
        strokeWidth="2"
      />
      <rect
        x="3"
        y="14"
        width="7"
        height="7"
        rx="1.5"
        stroke="#10a37f"
        strokeWidth="2"
      />
      <rect
        x="14"
        y="14"
        width="7"
        height="7"
        rx="1.5"
        stroke="#10a37f"
        strokeWidth="2"
      />
    </svg>
  ),
};

/** Chat chrome that wraps the widget iframe to simulate real ChatGPT / Claude UI. */
function ChatChrome({
  platform,
  theme,
  toolName,
  children,
}: {
  platform: string;
  theme: string;
  toolName: string;
  children: React.ReactNode;
}) {
  const dark = theme === "dark";
  const font =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  if (platform === "claude") {
    const bg = dark ? "#2b2a27" : "#eeece2";
    const msgBg = dark ? "#3c3b37" : "#ffffff";
    const textColor = dark ? "#e8e4db" : "#1a1915";
    const subColor = dark ? "#a39e93" : "#6b6560";
    const border = dark ? "#4a4843" : "#d8d4ca";
    return (
      <div
        style={{
          background: bg,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          fontFamily: font,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: `1px solid ${border}`,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {icons.hamburger(subColor)}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "4px",
            }}
          >
            <span
              style={{ fontSize: "15px", fontWeight: 600, color: textColor }}
            >
              Claude
            </span>
            {icons.chevronDown(subColor)}
          </div>
          {icons.compose(subColor)}
        </div>
        {/* Chat */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {/* Content column */}
          <div
            style={{
              maxWidth: "768px",
              margin: "0 auto",
              padding: "20px 16px",
            }}
          >
            {/* Assistant message */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: dark ? "#d4a574" : "#c67b3c",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "13px",
                  color: "#fff",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                C
              </div>
              <div
                style={{
                  fontSize: "14px",
                  lineHeight: "1.6",
                  color: textColor,
                  background: msgBg,
                  borderRadius: "18px",
                  padding: "10px 16px",
                }}
              >
                Here are your results:
              </div>
            </div>
            {/* Widget */}
            {children}
          </div>
        </div>
        {/* Input */}
        <div style={{ padding: "8px 12px 12px" }}>
          <div
            style={{
              maxWidth: "768px",
              margin: "0 auto",
              background: msgBg,
              borderRadius: "24px",
              border: `1px solid ${border}`,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {icons.plus(subColor)}
            <span style={{ flex: 1, fontSize: "14px", color: subColor }}>
              Reply to Claude...
            </span>
            {icons.mic(subColor)}
          </div>
        </div>
      </div>
    );
  }

  // OpenAI / ChatGPT — matching real UI from screenshots
  const bg = dark ? "#212121" : "#ffffff";
  const textColor = dark ? "#ececec" : "#0d0d0d";
  const subColor = dark ? "#8e8e8e" : "#8e8e8e";
  const inputBg = dark ? "#303030" : "#f4f4f4";
  const borderColor = dark ? "#3a3a3a" : "#e5e5e5";
  return (
    <div
      style={{
        background: bg,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: font,
      }}
    >
      {/* Header — matches real ChatGPT: hamburger | "ChatGPT v" | compose ... */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${borderColor}`,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {icons.hamburger(subColor)}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
          }}
        >
          <span style={{ fontSize: "15px", fontWeight: 600, color: textColor }}>
            ChatGPT
          </span>
          {icons.chevronDown(subColor)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {icons.share(subColor)}
          {icons.dots(subColor)}
        </div>
      </div>
      {/* Chat area */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Content column — centered with max-width like real ChatGPT */}
        <div
          style={{ maxWidth: "768px", margin: "0 auto", padding: "20px 16px" }}
        >
          {/* Tool label — like real ChatGPT shows MCP tool name */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "12px",
              fontSize: "13px",
              color: subColor,
            }}
          >
            {icons.mcpIcon}
            <span style={{ fontWeight: 500, color: dark ? "#b4b4b4" : "#555" }}>
              {toolName}
            </span>
          </div>
          {/* Widget — full width within the content column */}
          {children}
        </div>
      </div>
      {/* Input bar — matches real: rounded pill with +, MCP label, mic, send */}
      <div style={{ padding: "8px 12px 12px" }}>
        <div
          style={{
            maxWidth: "768px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "0",
          }}
        >
          <div
            style={{
              background: inputBg,
              borderRadius: "24px",
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: `1px solid ${borderColor}`,
            }}
          >
            {icons.plus(subColor)}
            <span style={{ flex: 1, fontSize: "14px", color: subColor }}>
              Ask anything
            </span>
            {icons.mic(subColor)}
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: dark ? "#676767" : "#0d0d0d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {icons.send}
            </div>
          </div>
          <div
            style={{
              textAlign: "center",
              fontSize: "11px",
              color: subColor,
              marginTop: "6px",
            }}
          >
            ChatGPT can make mistakes. Check important info.
          </div>
        </div>
      </div>
    </div>
  );
}

function ViewportFrame({
  hidden,
  children,
}: {
  hidden: boolean;
  children: React.ReactNode;
}) {
  const {
    viewportPreset,
    viewportCustom,
    platform,
    theme,
    displayMode,
    locale,
    strictMode,
    selected,
    resolveWidgetName: resolve,
  } = useStudioStore();
  const toolName =
    selected?.type === "tool"
      ? selected.tool.name
      : selected?.type === "widget"
        ? selected.name
        : resolve() || "Widget";
  const viewport =
    viewportPreset === "custom"
      ? viewportCustom
      : VIEWPORT_PRESETS[viewportPreset];

  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Compute scale to fit viewport within available container space
  useEffect(() => {
    const container = containerRef.current;
    if (!container || hidden) return;

    const update = () => {
      const availW = container.clientWidth - 32;
      const availH = container.clientHeight - 56;
      if (availW <= 0 || availH <= 0) return;
      const s = Math.min(1, availW / viewport.width, availH / viewport.height);
      setScale(s);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [viewport.width, viewport.height, hidden]);

  const scaledW = viewport.width * scale;
  const scaledH = viewport.height * scale;

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-hidden flex flex-col items-center justify-start p-4 ${
        hidden ? "hidden" : ""
      }`}
    >
      <div
        className="rounded-2xl border border-border overflow-hidden shrink-0"
        style={{ width: `${scaledW}px`, height: `${scaledH}px` }}
      >
        {/* Scaled viewport container */}
        <div
          style={{
            width: `${viewport.width}px`,
            height: `${viewport.height}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ChatChrome platform={platform} theme={theme} toolName={toolName}>
            {children}
          </ChatChrome>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
        <span className="font-medium text-foreground/70">
          {platform === "openai" ? "OpenAI" : "Claude"}
        </span>
        <span>·</span>
        <span>{theme}</span>
        <span>·</span>
        <span>{displayMode}</span>
        <span>·</span>
        <span>{locale}</span>
        <span>·</span>
        <span>
          {viewport.width} × {viewport.height}
          {scale < 1 && ` (${Math.round(scale * 100)}%)`}
        </span>
        {strictMode && (
          <>
            <span>·</span>
            <span className="text-emerald-500/80">strict CSP</span>
          </>
        )}
      </div>
    </div>
  );
}

type Tab = "widget" | "html" | "json";

/**
 * Renders the widget HTML source with CSP violation lines highlighted.
 * Static analysis already attaches a 1-based `lineNumber` to each violation,
 * so we group by line and tint each flagged line by severity. Clicking a
 * flagged line expands the directive + fix below it inline.
 */
function HtmlSourceView({
  source,
  violations,
}: {
  source: string;
  violations: CspViolation[];
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  // Static violations carry a meaningful line number; runtime ones often don't.
  // We only highlight lines we can actually point at.
  const byLine = useMemo(() => {
    const map = new Map<number, CspViolation[]>();
    for (const v of violations) {
      if (v.source !== "static" || !v.lineNumber || v.lineNumber <= 0) continue;
      const arr = map.get(v.lineNumber) || [];
      arr.push(v);
      map.set(v.lineNumber, arr);
    }
    return map;
  }, [violations]);

  const lines = useMemo(() => source.split("\n"), [source]);
  const gutterWidth = String(lines.length).length;

  const flaggedCount = byLine.size;
  const errorLines = useMemo(
    () =>
      Array.from(byLine.values()).filter((vs) =>
        vs.some((v) => v.severity === "error"),
      ).length,
    [byLine],
  );
  const warnLines = flaggedCount - errorLines;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {flaggedCount > 0 && (
        <div className="px-3 py-1.5 bg-secondary/50 shrink-0 flex items-center gap-2 text-[10px]">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
            HTML Source
          </span>
          {errorLines > 0 && (
            <span className="px-1.5 py-0 rounded-full bg-red-500/20 text-red-400 font-semibold">
              {errorLines} {errorLines === 1 ? "error" : "errors"}
            </span>
          )}
          {warnLines > 0 && (
            <span className="px-1.5 py-0 rounded-full bg-yellow-500/20 text-yellow-400 font-semibold">
              {warnLines} {warnLines === 1 ? "warning" : "warnings"}
            </span>
          )}
          <span className="text-muted-foreground/60 ml-1">
            click a highlighted line for fix
          </span>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className="text-[11px] font-mono leading-relaxed select-text">
          {lines.map((line, i) => {
            const lineNo = i + 1;
            const vs = byLine.get(lineNo);
            const hasError = vs?.some((v) => v.severity === "error");
            const isOpen = expanded === lineNo;

            const rowClass = vs
              ? hasError
                ? "bg-red-500/10 border-l-2 border-red-500/70 cursor-pointer hover:bg-red-500/15"
                : "bg-yellow-500/10 border-l-2 border-yellow-500/70 cursor-pointer hover:bg-yellow-500/15"
              : "border-l-2 border-transparent";

            return (
              <div key={i}>
                <div
                  className={`flex items-start ${rowClass}`}
                  onClick={
                    vs ? () => setExpanded(isOpen ? null : lineNo) : undefined
                  }
                >
                  <span
                    className="select-none text-muted-foreground/50 pr-3 pl-2 text-right shrink-0"
                    style={{ width: `${gutterWidth + 3}ch` }}
                  >
                    {lineNo}
                  </span>
                  <pre className="flex-1 whitespace-pre-wrap break-all text-foreground m-0">
                    {line || " "}
                  </pre>
                  {vs && (
                    <span
                      className={`shrink-0 px-2 text-[10px] ${
                        hasError ? "text-red-400" : "text-yellow-400"
                      }`}
                    >
                      {hasError ? "✕" : "!"}{" "}
                      {vs.length > 1 ? `×${vs.length}` : ""}
                    </span>
                  )}
                </div>
                {isOpen && vs && (
                  <div
                    className="text-[10px] font-mono space-y-2 px-3 py-2 ml-2 mr-3 my-1 rounded bg-secondary/60 border border-border/50 cursor-text"
                    style={{ marginLeft: `${gutterWidth + 5}ch` }}
                  >
                    {vs.map((v) => (
                      <div key={v.id} className="space-y-0.5">
                        <div>
                          <span
                            className={
                              v.severity === "error"
                                ? "text-red-400 font-bold"
                                : "text-yellow-400 font-bold"
                            }
                          >
                            {v.severity === "error" ? "✕" : "!"}
                          </span>{" "}
                          <span className="text-purple-400 font-semibold">
                            {v.directive}
                          </span>
                          {v.blockedUri && (
                            <span className="text-muted-foreground ml-2 break-all">
                              {v.blockedUri}
                            </span>
                          )}
                        </div>
                        {v.fix && (
                          <div className="text-green-400/80 whitespace-pre-line pl-4">
                            {v.fix}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export function WidgetPreview() {
  const {
    jsonOutput,
    lastResult,
    resolveWidgetName,
    setIframeRef,
    logAction,
    addPendingMessage,
    widgetSourceHtml,
    widgetRawHtml,
    currentMock,
    platform,
    strictMode,
    cspViolations,
    addCspViolation,
    setProtocolDetected,
  } = useStudioStore();
  const widgetName = resolveWidgetName();
  const [activeTab, setActiveTab] = useState<Tab>("widget");

  useEffect(() => {
    if (widgetName && lastResult) setActiveTab("widget");
    else if (!widgetName && jsonOutput) setActiveTab("json");
  }, [widgetName, lastResult, jsonOutput]);

  // Counts for the HTML tab badge - only static violations have line numbers
  // we can render, so the tab badge mirrors the in-view highlights.
  const htmlIssueCount = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    const seen = new Set<number>();
    for (const v of cspViolations) {
      if (v.source !== "static" || !v.lineNumber || v.lineNumber <= 0) continue;
      if (seen.has(v.lineNumber)) continue;
      seen.add(v.lineNumber);
      if (v.severity === "error") errors += 1;
      else warnings += 1;
    }
    return { errors, warnings };
  }, [cspViolations]);

  // Track the live iframe element via WidgetFrame's onIframeRef. The store
  // also keeps the ref (`setIframeRef`) so `applyMock` can hot-update
  // `iframe.contentWindow.openai` without forcing a full reload.
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null);
  const handleIframeRef = useCallback(
    (el: HTMLIFrameElement | null) => {
      setIframeEl(el);
      setIframeRef(el);
    },
    [setIframeRef],
  );

  // (Re)create extAppsMock whenever the iframe or mock changes. Tied to
  // both because: iframe ref turns over when the WidgetFrame remounts, and
  // each new mock needs a mock attached to the latest content window.
  useEffect(() => {
    if (!iframeEl || !currentMock) return;
    const mock = createExtAppsMock({
      iframe: iframeEl,
      mock: currentMock,
      onAction: logAction,
      onToolCall: async (name, args) => {
        logAction("system", `Calling tool "${name}"...`);
        return callTool(name, args, "widget");
      },
      onMessage: (content) =>
        addPendingMessage(platform === "openai" ? "openai" : "claude", content),
      hostName: platform === "openai" ? "chatgpt" : "mcp-studio",
      onProtocolDetected: () => setProtocolDetected("ext_apps"),
    });
    useStudioStore.setState({ _extAppsMock: mock });
    return () => {
      mock.destroy();
      useStudioStore.setState({ _extAppsMock: null });
    };
  }, [
    iframeEl,
    currentMock,
    platform,
    logAction,
    addPendingMessage,
    setProtocolDetected,
  ]);

  const handlePostMessage = useCallback(
    (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;
      if (data.type === "__studio_debug" && Array.isArray(data.args)) {
        // Iframe-side debug logs piped to the parent console. Gated on
        // window.__studioDebug - the bridge side won't even post these
        // unless the flag is on, so this is a defense-in-depth no-op
        // when the flag is off.
        dbg("iframe", ...data.args);
        return;
      }
      if (data.type === "studio_resize" && data.height && iframeEl) {
        iframeEl.style.height = `${data.height}px`;
        return;
      }
      if (data.type === "studio_sandbox_violation") {
        const categoryLabels: Record<string, string> = {
          storage: "sandbox (storage)",
          permission: "sandbox (permission)",
          device: "sandbox (device API)",
          worker: "sandbox (worker)",
          navigation: "sandbox (navigation)",
        };
        addCspViolation({
          id: `sb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          time: new Date().toTimeString().split(" ")[0],
          directive: categoryLabels[data.category] || "sandbox",
          blockedUri: data.api || "",
          sourceFile: widgetName || "",
          lineNumber: 0,
          columnNumber: 0,
          source: "runtime",
          severity: data.severity === "warning" ? "warning" : "error",
          fix:
            data.message ||
            `${data.api} is not available in widget sandboxed iframe`,
        });
        return;
      }
      if (data.type === "studio_protocol_detect") {
        setProtocolDetected(data.protocol);
        return;
      }
      if (data.type === "studio_action") {
        logAction(data.method, data.args);
        // callTool is already captured as mcp.request (source: "widget");
        // emitting widget.intent for it would double-record. Every other
        // legacy openai shim method is unique to this surface.
        if (data.method && data.method !== "callTool") {
          recorder.emit({
            kind: "widget.intent",
            name: String(data.method),
            params: data.args ?? {},
          });
        }
        if (data.method === "openExternal" && data.args?.url) {
          window.open(data.args.url, "_blank", "noopener,noreferrer");
        }
        if (data.method === "callTool" && data.args?.name && data.callId) {
          callTool(data.args.name, data.args.arguments || {})
            .then((result) => {
              logAction("callTool:result", { name: data.args.name, result });
              iframeEl?.contentWindow?.postMessage(
                { type: "studio_tool_result", callId: data.callId, result },
                "*",
              );
            })
            .catch((err) => {
              logAction("callTool:error", {
                name: data.args.name,
                error: (err as Error).message,
              });
              iframeEl?.contentWindow?.postMessage(
                {
                  type: "studio_tool_result",
                  callId: data.callId,
                  result: { error: (err as Error).message },
                },
                "*",
              );
            });
        }
        if (data.method === "sendFollowUpMessage") {
          addPendingMessage("openai", data.args);
        }
      }
    },
    [
      iframeEl,
      widgetName,
      addCspViolation,
      setProtocolDetected,
      logAction,
      addPendingMessage,
    ],
  );

  const handleCspViolation = useCallback(
    (event: SecurityPolicyViolationEvent) => {
      addCspViolation({
        id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: new Date().toTimeString().split(" ")[0],
        directive: event.violatedDirective,
        blockedUri: event.blockedURI || "(inline)",
        sourceFile: event.sourceFile || widgetName || "",
        lineNumber: event.lineNumber || 0,
        columnNumber: event.columnNumber || 0,
        source: "runtime",
        severity: "error",
      });
    },
    [addCspViolation, widgetName],
  );

  const hasWidget = !!widgetName;
  const hasHtml = hasWidget && !!widgetSourceHtml;
  const hasJson = !!jsonOutput || !!lastResult;
  const jsonText =
    jsonOutput || (lastResult ? JSON.stringify(lastResult, null, 2) : null);
  // Show the tab bar whenever there is more than one view to switch between.
  const tabCount = (hasWidget ? 1 : 0) + (hasHtml ? 1 : 0) + (hasJson ? 1 : 0);
  const showTabs = tabCount > 1;

  // No widget and no JSON — empty state
  if (!hasWidget && !hasJson) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No widget to preview
      </div>
    );
  }

  // Only JSON, no widget
  if (!hasWidget && hasJson) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 bg-secondary/50 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            JSON Response
          </span>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-foreground select-text">
            {jsonText}
          </pre>
        </ScrollArea>
      </div>
    );
  }

  // Has widget (possibly also HTML source / JSON) — show tabs when more than
  // one view is available.
  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
      active
        ? "text-foreground border-b-2 border-primary"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex border-b shrink-0">
        {showTabs && (
          <>
            <button
              onClick={() => setActiveTab("widget")}
              className={tabClass(activeTab === "widget")}
            >
              Widget
            </button>
            {hasHtml && (
              <button
                onClick={() => setActiveTab("html")}
                className={tabClass(activeTab === "html")}
              >
                HTML
                {htmlIssueCount.errors > 0 && (
                  <span className="px-1.5 py-0 rounded-full bg-red-500/20 text-red-400 font-semibold normal-case tracking-normal">
                    {htmlIssueCount.errors}
                  </span>
                )}
                {htmlIssueCount.warnings > 0 && (
                  <span className="px-1.5 py-0 rounded-full bg-yellow-500/20 text-yellow-400 font-semibold normal-case tracking-normal">
                    {htmlIssueCount.warnings}
                  </span>
                )}
              </button>
            )}
            {hasJson && (
              <button
                onClick={() => setActiveTab("json")}
                className={tabClass(activeTab === "json")}
              >
                JSON
              </button>
            )}
          </>
        )}
        <div className="ml-auto flex items-center">
          <button
            onClick={() => useStudioStore.getState().loadWidget()}
            className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            title="Reload widget HTML"
          >
            ↻ Reload
          </button>
        </div>
      </div>

      {/* Widget iframe - always mounted but hidden when another tab is
          active. Keeping it mounted preserves iframe state (scroll position,
          runtime message handlers) across tab switches. */}
      <ViewportFrame hidden={showTabs && activeTab !== "widget"}>
        {widgetRawHtml && currentMock ? (
          <WidgetFrame
            html={widgetRawHtml}
            mock={currentMock}
            platform={platform}
            strict={strictMode}
            baseUrl={getBaseUrl()}
            bridgeSource={
              recorder.mode === "recording" ? RECORDER_BRIDGE_SOURCE : undefined
            }
            onIframeRef={handleIframeRef}
            onPostMessage={handlePostMessage}
            onCspViolation={handleCspViolation}
            className="border-none block"
            style={{ width: "100%", minHeight: "100px" }}
          />
        ) : null}
      </ViewportFrame>

      {/* HTML source view */}
      {showTabs && activeTab === "html" && hasHtml && (
        <HtmlSourceView source={widgetSourceHtml!} violations={cspViolations} />
      )}

      {/* JSON view */}
      {showTabs && activeTab === "json" && (
        <ScrollArea className="flex-1 min-h-0">
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all text-foreground select-text">
            {jsonText}
          </pre>
        </ScrollArea>
      )}
    </div>
  );
}
