import { useState } from "react";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { stripTunnelUrls } from "@/lib/core/widget/inject";
import { CopyButton } from "@/components/ui/copy-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WidgetPreview } from "./widget-preview";
import { selectedIsWidgetTool, extractResourceResult } from "./utils";

function ReloadButton() {
  const reloadWidget = useWidgetStore((s) => s.reloadWidget);
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      title="Reload widget (picks up latest HTML)"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await reloadWidget();
        } finally {
          setLoading(false);
        }
      }}
      className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
    >
      <span className={loading ? "animate-spin" : ""}>↻</span>
      <span>Reload Widget</span>
    </button>
  );
}

type ViewTab = "preview" | "mock" | "html";

export function Preview({ widgetId }: { widgetId?: string } = {}) {
  const [tab, setTab] = useState<ViewTab>("preview");
  const activeWidgetId = useWidgetStore((s) => s.activeWidgetId);
  const targetId = widgetId ?? activeWidgetId;
  const entry = useWidgetStore((s) =>
    targetId ? (s.widgets[targetId] ?? null) : null,
  );
  const actions = useWidgetStore((s) => s.actions);

  const selected = useWidgetStore((s) => s.selected);
  const isWidgetTool = selectedIsWidgetTool(selected);
  const isResource = selected?.type === "resource";

  const hasWidget = entry !== null;

  const lastToolResult = (() => {
    if (isResource) return null;
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

  const resourceResult = isResource ? extractResourceResult(actions) : null;
  const hasResourceHtml =
    resourceResult?.htmlContent !== null &&
    resourceResult?.htmlContent !== undefined;

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

  const showPreviewTab = isWidgetTool || hasResourceHtml;
  const showHtmlTab = isWidgetTool || hasResourceHtml;

  const effectiveTab =
    !showPreviewTab && tab === "preview"
      ? "mock"
      : !showHtmlTab && tab === "html"
        ? "mock"
        : tab;

  const copyValue = (() => {
    if (effectiveTab === "mock") {
      if (hasWidget) return mockJson;
      if (resourceResult) return resourceResult.dataJson;
      return lastToolResult;
    }
    if (effectiveTab === "html") {
      if (hasWidget) return htmlSource;
      if (hasResourceHtml) return resourceResult!.htmlContent!;
    }
    return null;
  })();

  return (
    <Tabs
      value={effectiveTab}
      onValueChange={(v) => setTab(v as ViewTab)}
      className="flex-1 flex flex-col min-h-0 gap-0"
    >
      {/* Tab bar */}
      <div className="flex items-center justify-between px-3 py-1 border-b shrink-0">
        <TabsList variant="line" className="h-auto gap-3 p-0">
          {showPreviewTab && (
            <TabsTrigger
              value="preview"
              className="text-[10px] font-semibold uppercase tracking-wider px-0 py-1 h-auto rounded-none"
            >
              Preview
            </TabsTrigger>
          )}
          <TabsTrigger
            value="mock"
            className="text-[10px] font-semibold uppercase tracking-wider px-0 py-1 h-auto rounded-none"
          >
            Data
          </TabsTrigger>
          {showHtmlTab && (
            <TabsTrigger
              value="html"
              className="text-[10px] font-semibold uppercase tracking-wider px-0 py-1 h-auto rounded-none"
            >
              HTML Source
            </TabsTrigger>
          )}
        </TabsList>
        <div className="flex items-center gap-2">
          {hasWidget && <ReloadButton />}
          {copyValue && <CopyButton value={copyValue} />}
        </div>
      </div>

      <TabsContent value="preview" className="flex-1 min-h-0 flex flex-col">
        {hasWidget ? (
          <WidgetPreview widgetId={widgetId} />
        ) : hasResourceHtml ? (
          <iframe
            srcDoc={resourceResult!.htmlContent!}
            sandbox="allow-scripts"
            className="flex-1 w-full border-0"
            title="Resource Preview"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/30 text-muted-foreground text-sm">
            No preview available
          </div>
        )}
      </TabsContent>

      <TabsContent value="mock" className="flex-1 min-h-0 flex flex-col">
        {hasWidget ? (
          <ScrollArea className="flex-1 min-h-0">
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text p-3">
              {mockJson || "{}"}
            </pre>
          </ScrollArea>
        ) : resourceResult ? (
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Resource Result
              </div>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text border border-border/40 rounded p-3">
                {resourceResult.dataJson}
              </pre>
            </div>
          </ScrollArea>
        ) : lastToolResult ? (
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
        )}
      </TabsContent>

      <TabsContent value="html" className="flex-1 min-h-0 flex flex-col">
        {hasWidget ? (
          <ScrollArea className="flex-1 min-h-0">
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text p-3">
              {htmlSource}
            </pre>
          </ScrollArea>
        ) : hasResourceHtml ? (
          <ScrollArea className="flex-1 min-h-0">
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text p-3">
              {resourceResult!.htmlContent}
            </pre>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/30 text-muted-foreground text-sm">
            No HTML source
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
