import { useEffect, useRef, useState } from "react";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { useProfileStore } from "@/lib/studio/stores/profile-store";
import { useTestStore } from "@/lib/studio/stores/test-store";
import { Sidebar } from "@/components/studio/sidebar";
import { RequestEditor } from "@/components/studio/request-editor";
import { ActionLog } from "@/components/studio/action-log";
import { ConsoleLog } from "@/components/studio/console-log";
import { PendingMessages } from "@/components/studio/pending-messages";
import { WidgetConfig } from "@/components/studio/preview/preview-config";
import { Preview } from "@/components/studio/preview/preview";
import { CspPanel } from "@/components/studio/csp-panel";
import { OAuthDebugger } from "@/components/studio/oauth-debugger";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { TopHeader } from "@/components/studio/top-header";
import { SignInDialog } from "@/components/studio/sign-in-dialog";
import { PublishDialog } from "@/components/studio/publish-dialog";
import { ConfirmDialogRoot } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Realtime } from "@/components/studio/realtime";

type BottomTab = "logs" | "console" | "csp" | "oauth";

export function StudioLayout() {
  const selected = useWidgetStore((s) => s.selected);
  const cspViolations = useWidgetStore((s) => s.cspViolations);
  const consoleEntries = useWidgetStore((s) => s.consoleEntries);
  const oauthDebugEvents = useProfileStore((s) => s.oauthDebugEvents);
  const oauthDebugOpen = useProfileStore((s) => s.oauthDebugOpen);
  const setOAuthDebugOpen = useProfileStore((s) => s.setOAuthDebugOpen);
  const studioMode = useTestStore((s) => s.studioMode);
  const [bottomTab, setBottomTab] = useState<BottomTab>("logs");

  // Auto-switch to OAuth tab when debugger is opened from auth panel
  const prevDebugOpen = useRef(oauthDebugOpen);
  useEffect(() => {
    if (oauthDebugOpen && !prevDebugOpen.current) {
      setBottomTab("oauth");
    }
    prevDebugOpen.current = oauthDebugOpen;
  }, [oauthDebugOpen]);

  const headerLabel = selected
    ? selected.type === "widget"
      ? selected.name.replace(/_/g, " ")
      : selected.type === "tool"
        ? selected.tool.name.replace(/_/g, " ")
        : selected.resource.name || selected.resource.uri
    : "";

  const headerBadge =
    selected?.type === "tool"
      ? "TOOL"
      : selected?.type === "resource"
        ? "RESOURCE"
        : selected?.type === "widget"
          ? "WIDGET"
          : null;

  return (
    <div className="h-screen flex flex-col">
      <Realtime />
      <TopHeader />
      <SignInDialog />
      <PublishDialog />
      <ConfirmDialogRoot />
      <div className="flex-1 flex min-h-0 relative">
        {studioMode === "test" && (
          <div
            aria-hidden="true"
            className="absolute inset-0 z-40 bg-background/60 backdrop-blur-[1px] cursor-not-allowed"
          />
        )}
        <Sidebar />

        <ResizablePanelGroup
          orientation="horizontal"
          autoSaveId="mcp-studio:layout-split"
          className="flex-1 min-h-0"
        >
          <ResizablePanel defaultSize={45} minSize={28}>
            <div className="flex flex-col h-full min-w-0">
              <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
                <span className="font-semibold text-sm truncate">
                  {headerLabel}
                </span>
                {headerBadge && (
                  <Badge
                    variant={
                      selected?.type === "tool"
                        ? "default"
                        : selected?.type === "resource"
                          ? "secondary"
                          : "destructive"
                    }
                    className="text-[10px] px-1.5 py-0"
                  >
                    {headerBadge}
                  </Badge>
                )}
              </div>
              <ResizablePanelGroup
                orientation="vertical"
                autoSaveId="mcp-studio:editor-split-v2"
                className="flex-1 min-h-0"
              >
                <ResizablePanel defaultSize={58} minSize={15}>
                  <RequestEditor />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={42} minSize={20}>
                  <div className="flex flex-col h-full min-h-0">
                    <PendingMessages />
                    <div className="flex border-b shrink-0">
                      <button
                        onClick={() => setBottomTab("logs")}
                        className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                          bottomTab === "logs"
                            ? "text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Logs
                      </button>
                      <button
                        onClick={() => setBottomTab("console")}
                        className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                          bottomTab === "console"
                            ? "text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Console
                        {consoleEntries.length > 0 && (
                          <span
                            className={`px-1.5 py-0 rounded-full text-[10px] font-semibold ${
                              consoleEntries.some((e) => e.level === "error")
                                ? "bg-red-500/20 text-red-400"
                                : consoleEntries.some((e) => e.level === "warn")
                                  ? "bg-yellow-500/20 text-yellow-400"
                                  : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {consoleEntries.length}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => setBottomTab("csp")}
                        className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                          bottomTab === "csp"
                            ? "text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        CSP
                        {cspViolations.length > 0 && (
                          <span
                            className={`px-1.5 py-0 rounded-full text-[10px] font-semibold ${
                              cspViolations.some((v) => v.severity === "error")
                                ? "bg-red-500/20 text-red-400"
                                : "bg-yellow-500/20 text-yellow-400"
                            }`}
                          >
                            {cspViolations.length}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setBottomTab("oauth");
                          setOAuthDebugOpen(true);
                        }}
                        className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                          bottomTab === "oauth"
                            ? "text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        OAuth
                        {oauthDebugEvents.length > 0 && (
                          <span
                            className={`px-1.5 py-0 rounded-full text-[10px] font-semibold ${
                              oauthDebugEvents.some((e) => e.status === "error")
                                ? "bg-red-500/20 text-red-400"
                                : "bg-green-500/20 text-green-400"
                            }`}
                          >
                            {oauthDebugEvents.length}
                          </span>
                        )}
                      </button>
                    </div>
                    {bottomTab === "logs" ? (
                      <ActionLog />
                    ) : bottomTab === "console" ? (
                      <ConsoleLog />
                    ) : bottomTab === "csp" ? (
                      <CspPanel />
                    ) : (
                      <OAuthDebugger />
                    )}
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={55} minSize={35}>
            <div className="flex flex-col h-full min-w-0">
              <WidgetConfig />
              <Preview />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
