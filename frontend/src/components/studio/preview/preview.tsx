import { useState } from "react";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { stripTunnelUrls } from "@/lib/core/widget/inject";
import { CopyButton } from "@/components/ui/copy-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WidgetPreview } from "./widget-preview";

type ViewTab = "preview" | "mock" | "html";

export function Preview({ widgetId }: { widgetId?: string } = {}) {
  const [tab, setTab] = useState<ViewTab>("preview");
  const activeWidgetId = useWidgetStore((s) => s.activeWidgetId);
  const targetId = widgetId ?? activeWidgetId;
  const entry = useWidgetStore((s) =>
    targetId ? (s.widgets[targetId] ?? null) : null,
  );
  const actions = useWidgetStore((s) => s.actions);

  const hasWidget = entry !== null;

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

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as ViewTab)}
      className="flex-1 flex flex-col min-h-0 gap-0"
    >
      {/* Tab bar */}
      <div className="flex items-center justify-between px-3 py-1 border-b shrink-0">
        <TabsList variant="line" className="h-auto gap-3 p-0">
          <TabsTrigger
            value="preview"
            className="text-[10px] font-semibold uppercase tracking-wider px-0 py-1 h-auto rounded-none"
          >
            Preview
          </TabsTrigger>
          <TabsTrigger
            value="mock"
            className="text-[10px] font-semibold uppercase tracking-wider px-0 py-1 h-auto rounded-none"
          >
            Data
          </TabsTrigger>
          <TabsTrigger
            value="html"
            className="text-[10px] font-semibold uppercase tracking-wider px-0 py-1 h-auto rounded-none"
          >
            HTML Source
          </TabsTrigger>
        </TabsList>
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

      <TabsContent value="preview" className="flex-1 min-h-0 flex flex-col">
        {hasWidget ? (
          <WidgetPreview widgetId={widgetId} />
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

      <TabsContent value="mock" className="flex-1 min-h-0 flex flex-col">
        {hasWidget ? (
          <ScrollArea className="flex-1 min-h-0">
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text p-3">
              {mockJson || "{}"}
            </pre>
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
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/30 text-muted-foreground text-sm">
            No HTML source (not a widget)
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
