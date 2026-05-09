import { useCallback, useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronRight,
  Download,
  Loader2,
  Play,
  Trash2,
  XIcon,
  RefreshCw,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listTests, getTest, deleteTest } from "@/lib/tests/api";
import type { Recorded, Test, TestSummary } from "@/lib/recorder/schema";
import { summarize } from "@/lib/recorder/summarize";
import { useStudioStore } from "@/lib/studio/store";
import { createPlayer } from "@/lib/replay/player";
import { createBridgeClient } from "@/lib/replay/bridge-client";
import { chromeDriver } from "@/lib/replay/drivers/chrome";
import { mcpDriver } from "@/lib/replay/drivers/mcp";
import { widgetDriver } from "@/lib/replay/drivers/widget";
import { runtime } from "@/lib/replay/runtime";
import { TestPreconditionDialog } from "@/components/studio/test-precondition-dialog";
import { TestResultModal } from "@/components/studio/test-result-modal";
import { createArtifactCollector } from "@/lib/replay/artifacts";
import {
  buildReport,
  reportFilename,
  type ReplayReport,
} from "@/lib/replay/report";
import { saveReport } from "@/lib/tests/reports-api";
import { makePlayerStore } from "@/lib/replay/make-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

const KIND_COLOR: Record<string, string> = {
  "sidebar.select": "text-sky-400",
  "editor.set_args": "text-amber-400",
  "config.update": "text-violet-400",
  "auth.update": "text-violet-400",
  "mcp.request": "text-emerald-400",
  "mcp.response": "text-emerald-300/70",
  "mcp.notification": "text-emerald-200/70",
  "widget.render": "text-fuchsia-400",
  "widget.render.complete": "text-fuchsia-300/70",
  "widget.mock.set": "text-fuchsia-300",
  "widget.intent": "text-pink-400",
  "widget.dom.click": "text-orange-400",
  "widget.dom.input": "text-orange-300",
  "widget.dom.change": "text-orange-300",
  "widget.dom.submit": "text-orange-400",
  "widget.dom.keydown": "text-yellow-400",
  "csp.violation": "text-red-400",
};

function relMsLabel(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0).padStart(4, " ")}ms`;
  return `${(ms / 1000).toFixed(2).padStart(6, " ")}s`;
}

function ActionList({ timeline }: { timeline: Recorded[] }) {
  if (timeline.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground italic">
        Empty timeline.
      </p>
    );
  }
  return (
    <div className="py-1">
      {timeline.map((entry, i) => (
        <div
          key={i}
          className="px-4 py-1 text-[11px] font-mono flex items-center gap-2"
        >
          <span className="text-muted-foreground/60 w-8 shrink-0 text-right">
            {i + 1}
          </span>
          <span className="text-muted-foreground w-14 shrink-0 text-right">
            {relMsLabel(entry.relMs)}
          </span>
          <span
            className={`${KIND_COLOR[entry.kind] ?? "text-muted-foreground"} w-36 shrink-0 font-semibold truncate`}
          >
            {entry.kind}
          </span>
          <span className="text-muted-foreground truncate flex-1">
            {summarize(entry)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TestsPage({ open, onOpenChange }: Props) {
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<Test | null>(null);
  const [resultReport, setResultReport] = useState<ReplayReport | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedTests, setLoadedTests] = useState<Record<string, Test>>({});
  const [loadingName, setLoadingName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTests(await listTests());
      setLoadedTests({});
      setExpanded(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  async function handleExport(name: string) {
    setBusyName(name);
    try {
      const test = await getTest(name);
      // Download the full Test wrapper, not just the Session, so the export
      // round-trips through `saveTest` if shared with another user.
      const blob = new Blob([JSON.stringify(test, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete test "${name}"? This removes the file from disk.`))
      return;
    setBusyName(name);
    try {
      await deleteTest(name);
      setTests((prev) => prev.filter((t) => t.name !== name));
      setLoadedTests((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  function hasWidgetDom(test: Test): boolean {
    return test.session.timeline.some((e) => e.kind.startsWith("widget.dom."));
  }

  async function startRun(test: Test) {
    onOpenChange(false);
    const studio = useStudioStore.getState();
    const artifacts = createArtifactCollector();
    const player = createPlayer({
      store: makePlayerStore(),
      iframe: () => useStudioStore.getState()._iframeRef,
      bridge: createBridgeClient(() => useStudioStore.getState()._iframeRef),
      drivers: [chromeDriver, mcpDriver, widgetDriver],
      artifacts,
    });
    runtime.begin(
      test.name,
      test.description,
      test.session.timeline.length,
      () => player.abort(),
    );
    try {
      const result = await player.run(test, (p) =>
        runtime.step(p.index, p.current, p.step),
      );
      runtime.finish(result);
      const report = buildReport({
        runResult: result,
        artifacts: artifacts.finalize(),
        preconditions: {
          strictModeOk: !studio.strictMode,
          iframeReady: !!useStudioStore.getState()._iframeRef,
        },
      });
      setResultReport(report);
      setResultOpen(true);
    } catch (e) {
      alert(`Test failed to run: ${(e as Error).message}`);
    } finally {
      runtime.clear();
    }
  }

  async function handleSaveReport(report: ReplayReport) {
    await saveReport(reportFilename(report), report);
  }

  async function toggleExpanded(name: string) {
    const next = new Set(expanded);
    if (next.has(name)) {
      next.delete(name);
      setExpanded(next);
      return;
    }
    next.add(name);
    setExpanded(next);
    if (!loadedTests[name]) {
      setLoadingName(name);
      try {
        const test = await getTest(name);
        setLoadedTests((prev) => ({ ...prev, [name]: test }));
      } catch (e) {
        setError((e as Error).message);
        const undo = new Set(next);
        undo.delete(name);
        setExpanded(undo);
      } finally {
        setLoadingName(null);
      }
    }
  }

  async function handleRun(name: string) {
    setBusyName(name);
    try {
      const test = await getTest(name);
      const studio = useStudioStore.getState();
      if (studio.strictMode && hasWidgetDom(test)) {
        setPendingRun(test);
        return;
      }
      await startRun(test);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-0 right-0 z-50 h-screen w-[640px] max-w-[95vw] bg-popover text-sm text-popover-foreground border-l shadow-2xl outline-none flex flex-col data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right duration-150"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 gap-2">
            <DialogPrimitive.Title className="text-sm font-medium flex items-center gap-2">
              Tests
              <span className="text-xs font-normal text-muted-foreground">
                {tests.length}
              </span>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={refresh}
                title="Refresh"
                disabled={loading}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                />
              </Button>
              <DialogPrimitive.Close
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>
          {error && (
            <div className="px-4 py-2 text-xs text-destructive font-mono border-b">
              {error}
            </div>
          )}
          <div className="flex-1 overflow-y-auto min-h-0">
            {!loading && tests.length === 0 ? (
              <p className="text-center text-muted-foreground text-xs py-12 px-6">
                No tests saved yet. Open Action history (clock icon), use Mark
                start / Mark end to slice the log, then Save.
              </p>
            ) : (
              tests.map((t) => {
                const isOpen = expanded.has(t.name);
                const loaded = loadedTests[t.name];
                const isLoading = loadingName === t.name;
                return (
                  <div key={t.name} className="border-b border-border/30">
                    <div className="px-4 py-3 hover:bg-secondary/20">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(t.name)}
                          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-transform"
                          title={isOpen ? "Collapse actions" : "Show actions"}
                          style={{ transform: isOpen ? "rotate(90deg)" : "" }}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(t.name)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold truncate">
                              {t.displayName ?? t.name}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {t.name}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {t.totalActions ?? 0} action
                            {t.totalActions === 1 ? "" : "s"}
                            {" · "}
                            saved {formatTime(t.modifiedMs)}
                          </div>
                          {t.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {t.description}
                            </p>
                          )}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRun(t.name)}
                            disabled={busyName === t.name}
                            title="Replay this test"
                          >
                            <Play className="h-3.5 w-3.5 mr-1.5" />
                            Run
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleExport(t.name)}
                            disabled={busyName === t.name}
                            title="Download JSON"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDelete(t.name)}
                            disabled={busyName === t.name}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="bg-muted/10 border-t border-border/30">
                        {isLoading && (
                          <div className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading actions…
                          </div>
                        )}
                        {!isLoading && loaded && (
                          <ActionList timeline={loaded.session.timeline} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
      {pendingRun && (
        <TestPreconditionDialog
          open={true}
          testName={pendingRun.name}
          onCancel={() => setPendingRun(null)}
          onProceed={async () => {
            const test = pendingRun;
            setPendingRun(null);
            useStudioStore.getState().setStrictMode(false);
            await new Promise((r) => setTimeout(r, 100));
            await startRun(test);
          }}
        />
      )}
      <TestResultModal
        report={resultReport}
        open={resultOpen}
        onOpenChange={(v) => {
          setResultOpen(v);
          if (!v) setResultReport(null);
        }}
        onSaveToDisk={handleSaveReport}
      />
    </Dialog>
  );
}
