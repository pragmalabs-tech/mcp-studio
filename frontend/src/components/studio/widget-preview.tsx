import { useEffect, useRef, useState } from "react";
import { useStudioStore } from "@/lib/studio/store";
import { renderHtml } from "@/lib/core/widget/render-html";
import { createClaudeMock } from "@/lib/studio/mock-claude";
import { callTool } from "@/lib/studio/api";
import { extractCspDomains } from "@/lib/core/csp/profiles";
import { analyze } from "@/lib/core/csp/analyze";
import { stripTunnelUrls } from "@/lib/core/widget/inject";
import type { CspFinding } from "@/lib/core/csp/types";
import { CopyButton } from "@/components/ui/copy-button";
import { ScrollArea } from "@/components/ui/scroll-area";

type ViewTab = "preview" | "mock" | "html";

/** Convert a static-analysis finding into the panel-shaped violation.
 *  Duplicates the shape from store.toStaticViolation (kept local since
 *  the conversion is shallow). */
function findingToViolation(finding: CspFinding, sourceFile: string) {
  return {
    id: `static_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toTimeString().split(" ")[0],
    directive: finding.directive,
    blockedUri: finding.blocked,
    sourceFile,
    lineNumber: finding.line || 0,
    columnNumber: 0,
    source: "static" as const,
    fix: finding.fix,
    severity: finding.severity,
    platforms: finding.platforms,
    snippet: finding.snippet,
  };
}

/**
 * Renders the widget pointed at by `props.widgetId` (override) or
 * `store.activeWidgetId`. Mount effect writes HTML into the iframe, runs
 * CSP analysis, wires the ext-apps mock, and after `entry.waitMs`
 * captures `outerHTML` back into the store via `setSnapshot` — which
 * resolves the promise the originating Action is awaiting.
 *
 * Entries that already carry a `snapshot` short-circuit the mount cycle:
 * the comparison dialog can mount a second `<WidgetPreview>` pointing at
 * a recorded entry and see the captured DOM without a fresh wait.
 */
export function WidgetPreview({ widgetId }: { widgetId?: string } = {}) {
  const [tab, setTab] = useState<ViewTab>("preview");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeWidgetId = useStudioStore((s) => s.activeWidgetId);
  const targetId = widgetId ?? activeWidgetId;
  const entry = useStudioStore((s) =>
    targetId ? (s.widgets[targetId] ?? null) : null,
  );
  const platform = useStudioStore((s) => s.platform);
  const strictMode = useStudioStore((s) => s.strictMode);
  const addConsoleEntry = useStudioStore((s) => s.addConsoleEntry);
  const logAction = useStudioStore((s) => s.logAction);
  const addPendingMessage = useStudioStore((s) => s.addPendingMessage);
  const getViewportSize = useStudioStore((s) => s.getViewportSize);
  const addCspViolation = useStudioStore((s) => s.addCspViolation);

  // Publish iframe ref so other store consumers (mock-claude.ts) can reach it.
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

  // Mount + snapshot effect — fires when the target entry changes.
  useEffect(() => {
    if (!targetId || !entry) return;
    if (entry.snapshot !== null) return; // already captured — skip remount
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;

    const { html: finalHtml } = renderHtml({
      html: entry.html,
      mock: entry.mock,
      platform,
      strict: strictMode,
    });

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(finalHtml);
    doc.close();

    // CSP static analysis (moved from store.renderWidget).
    const cspDomains = extractCspDomains(
      (entry.mock._meta || {}) as Record<string, unknown>,
    );
    const { findings } = analyze(stripTunnelUrls(entry.html), cspDomains);
    for (const finding of findings) {
      addCspViolation(findingToViolation(finding, targetId));
    }

    // ext-apps mock — owns the post-message JSON-RPC dance with the widget.
    const prev = useStudioStore.getState()._extAppsMock;
    if (prev) {
      prev.destroy();
      useStudioStore.setState({ _extAppsMock: null });
    }
    let extAppsMock: ReturnType<typeof createClaudeMock> | null = null;
    if (platform === "claude") {
      extAppsMock = createClaudeMock(
        iframe,
        entry.mock,
        (method, args) => logAction(method, args),
        (name, args) => callTool(name, args),
        (content) => addPendingMessage("claude", content),
      );
      useStudioStore.setState({ _extAppsMock: extAppsMock });
    }

    const timer = setTimeout(() => {
      const snap = doc.documentElement.outerHTML;
      useStudioStore.getState().setSnapshot(targetId, snap);
    }, entry.waitMs);

    return () => {
      clearTimeout(timer);
      extAppsMock?.destroy();
    };
  }, [
    targetId,
    entry,
    platform,
    strictMode,
    logAction,
    addPendingMessage,
    addCspViolation,
  ]);

  const viewportSize = getViewportSize();
  const actions = useStudioStore((s) => s.actions);

  // Get the last tool call result for display when no widget
  const lastToolResult = (() => {
    const toolCalls = actions.filter((a) => a.method === "tools/call");
    if (toolCalls.length === 0) return null;
    const last = toolCalls[toolCalls.length - 1];
    try {
      const parsed = JSON.parse(last.args);
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
      return JSON.stringify(parsed.result || parsed, null, 2);
    } catch {
      return last.args;
    }
  })();

  const mockJson = entry
    ? JSON.stringify(
        {
          toolInput: entry.mock.toolInput,
          toolOutput: entry.mock.toolOutput,
          _meta: entry.mock._meta,
          widgetState: entry.mock.widgetState,
          theme: entry.mock.theme,
          locale: entry.mock.locale,
          displayMode: entry.mock.displayMode,
        },
        null,
        2,
      )
    : "";

  const htmlSource = entry ? stripTunnelUrls(entry.html) : "";
  const hasWidget = entry !== null;

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
          (hasWidget ? (
            <CopyButton value={mockJson} />
          ) : lastToolResult ? (
            <CopyButton value={lastToolResult} />
          ) : null)}
        {tab === "html" && hasWidget && <CopyButton value={htmlSource} />}
        {tab === "preview" && !hasWidget && lastToolResult && (
          <CopyButton value={lastToolResult} />
        )}
      </div>

      {/* Content area */}
      {!hasWidget ? (
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
