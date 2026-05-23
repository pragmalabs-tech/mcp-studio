import { useEffect, useRef, useState } from "react";
import { useStudioStore } from "@/lib/studio/store";
import { renderHtml } from "@/lib/core/widget/render-html";
import type { MockData } from "@/lib/studio/mock-openai";
import { createClaudeMock } from "@/lib/studio/mock-claude";
import { callTool } from "@/lib/studio/api";
import { CopyButton } from "@/components/ui/copy-button";
import { ScrollArea } from "@/components/ui/scroll-area";

type ViewTab = "preview" | "mock" | "html";

export function WidgetPreview() {
  const [tab, setTab] = useState<ViewTab>("preview");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widgetRawHtml = useStudioStore((s) => s.widgetRawHtml);
  const currentMock = useStudioStore((s) => s.currentMock);
  const platform = useStudioStore((s) => s.platform);
  const strictMode = useStudioStore((s) => s.strictMode);
  const addConsoleEntry = useStudioStore((s) => s.addConsoleEntry);
  const logAction = useStudioStore((s) => s.logAction);
  const addPendingMessage = useStudioStore((s) => s.addPendingMessage);
  const getViewportSize = useStudioStore((s) => s.getViewportSize);

  // Store iframe ref in global store so other parts can access it
  useEffect(() => {
    useStudioStore.setState({ _iframeRef: iframeRef.current });
  }, []);

  // Forward console messages from iframe to studio console, and bridge
  // legacy-OpenAI `window.openai.callTool` calls through the real MCP
  // (the mock-openai script proxies the call out via postMessage with a
  // `callId`; we resolve it back into the iframe with `studio_tool_result`).
  useEffect(() => {
    const handleMessage = async (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;
      if (data.type === "studio_console") {
        addConsoleEntry(data.level, data.args);
        return;
      }
      if (
        data.type === "studio_action" &&
        data.method === "callTool" &&
        data.callId
      ) {
        const iframe = iframeRef.current;
        const args = data.args as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const name = args?.name || "";
        const toolArgs = args?.arguments || {};
        logAction("callTool", { name, arguments: toolArgs });
        try {
          const result = await callTool(name, toolArgs);
          logAction("callTool:result", { name, result });
          iframe?.contentWindow?.postMessage(
            { type: "studio_tool_result", callId: data.callId, result },
            "*",
          );
        } catch (err) {
          logAction("callTool:error", {
            name,
            error: (err as Error).message,
          });
          iframe?.contentWindow?.postMessage(
            {
              type: "studio_tool_result",
              callId: data.callId,
              result: { error: (err as Error).message },
            },
            "*",
          );
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [addConsoleEntry, logAction]);

  // Render widget when HTML or mock changes
  useEffect(() => {
    if (!widgetRawHtml || !currentMock || !iframeRef.current) return;

    const mock: MockData = {
      toolInput: currentMock.toolInput || {},
      toolOutput: currentMock.toolOutput || {},
      _meta: currentMock._meta || {},
      widgetState: currentMock.widgetState || null,
      theme: currentMock.theme,
      locale: currentMock.locale,
      displayMode: currentMock.displayMode,
    };

    const { html } = renderHtml({
      html: widgetRawHtml,
      mock,
      platform,
      strict: strictMode,
    });

    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(html);
    doc.close();

    // Clean up previous mock
    const prevMock = useStudioStore.getState()._extAppsMock;
    if (prevMock) {
      prevMock.destroy();
      useStudioStore.setState({ _extAppsMock: null });
    }

    // Set up ext-apps mock for Claude platform or OpenAI ext-apps mode.
    // `onToolCall` forwards `ui/call-server-tool` to the real MCP server so
    // widgets can invoke tools and receive responses (matches ChatGPT /
    // Claude behaviour). `onMessage` surfaces `ui/message` payloads as
    // pending messages so the user can see what the widget sent.
    if (platform === "claude" && iframe) {
      const extAppsMock = createClaudeMock(
        iframe,
        mock,
        (method, args) => logAction(method, args),
        (name, args) => callTool(name, args),
        (content) => addPendingMessage("claude", content),
      );
      useStudioStore.setState({ _extAppsMock: extAppsMock });
    }
  }, [
    widgetRawHtml,
    currentMock,
    platform,
    strictMode,
    logAction,
    addPendingMessage,
  ]);

  const viewportSize = getViewportSize();
  const widgetSourceHtml = useStudioStore((s) => s.widgetSourceHtml);
  const actions = useStudioStore((s) => s.actions);

  // Get the last tool call result for display when no widget
  const lastToolResult = (() => {
    const toolCalls = actions.filter((a) => a.method === "tools/call");
    if (toolCalls.length === 0) return null;
    const last = toolCalls[toolCalls.length - 1];
    try {
      const parsed = JSON.parse(last.args);
      // Try to extract structured content or text content
      if (parsed.structuredContent) {
        return JSON.stringify(parsed.structuredContent, null, 2);
      }
      if (parsed.result?.structuredContent) {
        return JSON.stringify(parsed.result.structuredContent, null, 2);
      }
      if (parsed.result?.content?.[0]?.text) {
        try {
          const textContent = JSON.parse(parsed.result.content[0].text);
          return JSON.stringify(textContent, null, 2);
        } catch {
          return parsed.result.content[0].text;
        }
      }
      // Fallback to full result
      return JSON.stringify(parsed.result || parsed, null, 2);
    } catch {
      return last.args;
    }
  })();

  const mockJson = currentMock
    ? JSON.stringify(
        {
          toolInput: currentMock.toolInput,
          toolOutput: currentMock.toolOutput,
          _meta: currentMock._meta,
          widgetState: currentMock.widgetState,
          theme: currentMock.theme,
          locale: currentMock.locale,
          displayMode: currentMock.displayMode,
        },
        null,
        2,
      )
    : "";

  const htmlSource = widgetSourceHtml || widgetRawHtml || "";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b shrink-0">
        <div className="flex items-center gap-3">
          <TabButton
            active={tab === "preview"}
            onClick={() => setTab("preview")}
          >
            Preview
          </TabButton>
          <TabButton active={tab === "mock"} onClick={() => setTab("mock")}>
            Data
          </TabButton>
          <TabButton active={tab === "html"} onClick={() => setTab("html")}>
            HTML Source
          </TabButton>
        </div>
        {tab === "mock" &&
          (widgetRawHtml ? (
            <CopyButton value={mockJson} />
          ) : lastToolResult ? (
            <CopyButton value={lastToolResult} />
          ) : null)}
        {tab === "html" && widgetRawHtml && <CopyButton value={htmlSource} />}
        {tab === "preview" && !widgetRawHtml && lastToolResult && (
          <CopyButton value={lastToolResult} />
        )}
      </div>

      {/* Content area */}
      {!widgetRawHtml ? (
        // No widget loaded - show tool result or empty state based on tab
        tab === "preview" ? (
          lastToolResult ? (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Tool Result
                </div>
                <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text border border-border/40 rounded p-3">
                  {lastToolResult}
                </pre>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-muted/30 text-muted-foreground text-sm">
              No data to display
            </div>
          )
        ) : tab === "mock" ? (
          lastToolResult ? (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Tool Result
                </div>
                <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text border border-border/40 rounded p-3">
                  {lastToolResult}
                </pre>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-muted/30 text-muted-foreground text-sm">
              No data to display
            </div>
          )
        ) : (
          // HTML Source tab - empty when no widget
          <div className="flex-1 flex items-center justify-center bg-muted/30 text-muted-foreground text-sm">
            No HTML source (not a widget)
          </div>
        )
      ) : tab === "preview" ? (
        <div className="flex-1 flex items-center justify-center bg-muted/30 p-4 overflow-auto">
          <div
            style={{
              width: viewportSize.width,
              height: viewportSize.height,
              maxWidth: "100%",
              maxHeight: "100%",
            }}
            className="bg-background border rounded-lg shadow-lg overflow-hidden"
          >
            <iframe
              ref={iframeRef}
              className="w-full h-full"
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              title="Widget Preview"
            />
          </div>
        </div>
      ) : tab === "mock" ? (
        <ScrollArea className="flex-1 min-h-0">
          <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text p-3">
            {mockJson || "{}"}
          </pre>
        </ScrollArea>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text p-3">
            {htmlSource}
          </pre>
        </ScrollArea>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] font-semibold uppercase tracking-wider transition-colors py-0.5 ${
        active
          ? "text-foreground border-b-2 border-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
