import { useCallback, useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  ChevronRight,
  Download,
  Loader2,
  Play,
  StepForward,
  Trash2,
  XIcon,
  RefreshCw,
  EyeOff,
  Eye,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { listTests, getTrace, deleteTest } from "@/lib/tests/api";
import type { TestSummary } from "@/lib/recorder/schema";
import { useStudioStore } from "@/lib/studio/store";
import { run as runEngine } from "@/lib/core/engine";
import { diff } from "@/lib/core/differ";
import { allVolatilePaths } from "@/lib/core/registry";
import { buildRuntimeDrivers } from "@/lib/core/runtime";
import { createBridgeClient } from "@/lib/engine/bridge-client";
import { TestPreconditionDialog } from "@/components/studio/test-precondition-dialog";
import { TraceModal } from "@/lib/core/views/trace-modal";
import type { Action, Step, Trace, Verdict } from "@/lib/core/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

/** Render the test's action count, accounting for the visible filter.
 *  Shows "X of Y actions" when filter is active and hides some, otherwise
 *  the simple "Y actions". */
function ActionCountLabel({
  total,
  visible,
  hideObservations,
  savedAt,
}: {
  total: number;
  visible: number | null;
  hideObservations: boolean;
  savedAt: number;
}) {
  const showFraction =
    hideObservations && visible !== null && visible !== total;
  return (
    <div className="text-[10px] text-muted-foreground mt-0.5">
      {showFraction
        ? `${visible} of ${total} actions visible`
        : `${total} action${total === 1 ? "" : "s"}`}
      {" · "}
      saved {formatTime(savedAt)}
    </div>
  );
}

/** True if `action` is a server/widget-source effect rather than a
 *  user-driven step. Used by the "Inputs only" filter. */
export function isObservation(action: Action): boolean {
  if (action.source === "server" || action.source === "widget") return true;
  return false;
}

function ActionList({
  steps,
  hideObservations,
}: {
  steps: readonly Step[];
  hideObservations: boolean;
}) {
  const visible = hideObservations
    ? steps.filter((s) => !isObservation(s.action))
    : steps;
  if (visible.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground italic">
        {steps.length === 0
          ? "Empty trace."
          : "All steps are observations — turn the filter off to see them."}
      </p>
    );
  }
  return (
    <div className="py-1">
      {visible.map((step, i) => (
        <div
          key={i}
          className="px-4 py-1 text-[11px] font-mono flex items-center gap-2"
        >
          <span className="text-muted-foreground/60 w-8 shrink-0 text-right">
            {i + 1}
          </span>
          <span className="text-foreground w-40 shrink-0 font-semibold truncate">
            {step.action.driver}.{step.action.kind}
          </span>
          <span className="text-muted-foreground truncate flex-1">
            {step.action.source}
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
  const [pendingRun, setPendingRun] = useState<{
    test: Trace;
    mode: "auto" | "step";
  } | null>(null);
  const [resultData, setResultData] = useState<{
    recorded: Trace;
    replayed: Trace;
    verdict: Verdict;
  } | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedTests, setLoadedTests] = useState<Record<string, Trace>>({});
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [hideObservations, setHideObservations] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<TestSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      const trace = await getTrace(name);
      // Download the Trace JSON verbatim so the export round-trips
      // through `saveTrace` if shared with another user.
      const blob = new Blob([JSON.stringify(trace, null, 2)], {
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

  function requestDelete(t: TestSummary) {
    setPendingDelete(t);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const name = pendingDelete.name;
    setDeleting(true);
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
      setPendingDelete(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
      setBusyName(null);
    }
  }

  function hasWidgetDom(trace: Trace): boolean {
    return trace.steps.some(
      (s) => s.action.driver === "widget" && s.action.kind.startsWith("dom."),
    );
  }

  async function startRun(recorded: Trace, _mode: "auto" | "step" = "auto") {
    onOpenChange(false);
    const ctrl = new AbortController();
    try {
      const bridge = createBridgeClient(
        () => useStudioStore.getState()._iframeRef,
      );
      // BridgeClient's dispatch signature differs slightly from our
      // RuntimeBridge; adapt at the boundary.
      const replayed = await runEngine(recorded, {
        signal: ctrl.signal,
        drivers: buildRuntimeDrivers({
          dispatch: async (selectors, kind, _extra) => {
            await bridge.dispatch(
              { kind: kind as never, selectors } as never,
              2_000,
            );
          },
        }),
      });
      const verdict = diff(recorded, replayed, allVolatilePaths());
      setResultData({ recorded, replayed, verdict });
      setResultOpen(true);
    } catch (e) {
      alert(`Test failed to run: ${(e as Error).message}`);
    }
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
        const trace = await getTrace(name);
        setLoadedTests((prev) => ({ ...prev, [name]: trace }));
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

  async function handleRun(name: string, mode: "auto" | "step" = "auto") {
    setBusyName(name);
    try {
      const trace = await getTrace(name);
      const studio = useStudioStore.getState();
      if (studio.strictMode && hasWidgetDom(trace)) {
        setPendingRun({ test: trace, mode });
        return;
      }
      await startRun(trace, mode);
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
                size="sm"
                onClick={() => setHideObservations((v) => !v)}
                title={
                  hideObservations
                    ? "Showing inputs only — click to also show observations (responses, render-completes, etc.)"
                    : "Showing all actions — click to hide observations"
                }
              >
                {hideObservations ? (
                  <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5 mr-1.5" />
                )}
                {hideObservations ? "Inputs only" : "All actions"}
              </Button>
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
                          <ActionCountLabel
                            total={t.totalActions ?? 0}
                            visible={
                              loaded
                                ? loaded.steps.filter(
                                    (s) =>
                                      !hideObservations ||
                                      !isObservation(s.action),
                                  ).length
                                : null
                            }
                            hideObservations={hideObservations}
                            savedAt={t.modifiedMs}
                          />
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
                            onClick={() => handleRun(t.name, "auto")}
                            disabled={busyName === t.name}
                            title="Replay this test (auto, ~150ms between steps)"
                          >
                            <Play className="h-3.5 w-3.5 mr-1.5" />
                            Run
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRun(t.name, "step")}
                            disabled={busyName === t.name}
                            title="Step through manually — pauses after each action"
                          >
                            <StepForward className="h-3.5 w-3.5 mr-1.5" />
                            Step
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
                            onClick={() => requestDelete(t)}
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
                          <ActionList
                            steps={loaded.steps}
                            hideObservations={hideObservations}
                          />
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
          testName={pendingRun.test.name}
          onCancel={() => setPendingRun(null)}
          onProceed={async () => {
            const { test, mode } = pendingRun;
            setPendingRun(null);
            useStudioStore.getState().setStrictMode(false);
            await new Promise((r) => setTimeout(r, 100));
            await startRun(test, mode);
          }}
        />
      )}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(v) => {
          if (!v && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-red-500/10 text-red-400">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete this test?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="text-foreground font-medium">
                {pendingDelete?.displayName ?? pendingDelete?.name}
              </span>{" "}
              ({pendingDelete?.totalActions ?? 0} action
              {pendingDelete?.totalActions === 1 ? "" : "s"}) will be
              permanently removed from{" "}
              <span className="font-mono">~/.mcp-studio/tests/</span>. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TraceModal
        recorded={resultData?.recorded ?? null}
        replayed={resultData?.replayed ?? null}
        verdict={resultData?.verdict ?? null}
        open={resultOpen}
        onOpenChange={(v) => {
          setResultOpen(v);
          if (!v) setResultData(null);
        }}
      />
    </Dialog>
  );
}
