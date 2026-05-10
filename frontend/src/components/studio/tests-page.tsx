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
import { listTests, getTest, deleteTest } from "@/lib/tests/api";
import type { Recorded, Test, TestSummary } from "@/lib/recorder/schema";
import { KIND, OBSERVATION_KINDS } from "@/lib/recorder/kinds";
import { KIND_COLOR } from "@/lib/engine/kind-colors";
import { summarize } from "@/lib/recorder/summarize";
import { useStudioStore } from "@/lib/studio/store";
import { createEngine } from "@/lib/engine/engine";
import { createBridgeClient } from "@/lib/engine/bridge-client";
import { chromeDriver } from "@/lib/engine/drivers/chrome";
import { mcpDriver } from "@/lib/engine/drivers/mcp";
import { widgetDriver } from "@/lib/engine/drivers/widget";
import { runtime } from "@/lib/engine/runtime";
import { TestPreconditionDialog } from "@/components/studio/test-precondition-dialog";
import { TestAuthPreconditionDialog } from "@/components/studio/test-auth-precondition-dialog";
import { TestResultModal } from "@/components/studio/test-result-modal";
import { getBearerToken, loadOAuthTokens } from "@/lib/studio/api";
import { createArtifactCollector } from "@/lib/engine/artifacts";
import {
  buildReport,
  reportFilename,
  type ReplayReport,
} from "@/lib/engine/report";
import { saveReport } from "@/lib/tests/reports-api";
import { makeEngineStore } from "@/lib/engine/make-store";

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

function relMsLabel(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0).padStart(4, " ")}ms`;
  return `${(ms / 1000).toFixed(2).padStart(6, " ")}s`;
}

/** True if `entry` is something the Player observes rather than drives.
 *  Drives the "Inputs only" filter. Widget-source mcp.request counts as
 *  an observation because the widget itself fires it as a side effect. */
export function isObservation(entry: Recorded): boolean {
  if (OBSERVATION_KINDS.has(entry.kind)) return true;
  if (entry.kind === KIND.MCP_REQUEST && entry.source === "widget") return true;
  return false;
}

function ActionList({
  timeline,
  hideObservations,
}: {
  timeline: Recorded[];
  hideObservations: boolean;
}) {
  const visible = hideObservations
    ? timeline.filter((e) => !isObservation(e))
    : timeline;
  if (visible.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground italic">
        {timeline.length === 0
          ? "Empty timeline."
          : "All entries are observations — turn the filter off to see them."}
      </p>
    );
  }
  return (
    <div className="py-1">
      {visible.map((entry, i) => (
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
  const profiles = useStudioStore((s) => s.profiles);
  const profilesById = new Map(profiles.map((p) => [p.id, p.name]));
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<{
    test: Test;
    mode: "auto" | "step";
  } | null>(null);
  const [pendingAuth, setPendingAuth] = useState<{
    test: Test;
    mode: "auto" | "step";
    reason: string;
  } | null>(null);
  const [resultReport, setResultReport] = useState<ReplayReport | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedTests, setLoadedTests] = useState<Record<string, Test>>({});
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

  function hasWidgetDom(test: Test): boolean {
    return test.session.timeline.some((e) => e.kind.startsWith("widget.dom."));
  }

  /**
   * Check whether the active profile has the auth a test needs. Returns
   * `null` when good to go, or a human-readable reason to surface in the
   * precondition dialog. The "needs auth" signal is whether the recording
   * went out with an authed method; tests recorded against open servers
   * skip the check.
   */
  function describeMissingAuth(test: Test): string | null {
    const studio = useStudioStore.getState();
    const recordedMethod = test.session.setup.connect.auth.method;
    if (recordedMethod === "bearer" && !test.session.setup.connect.auth.token) {
      return null;
    }
    const profile = studio.profiles.find(
      (p) => p.id === studio.activeProfileId,
    );
    const auth = profile?.auth;
    if (!auth || auth.method === "none") {
      return "the active profile has no auth configured";
    }
    if (auth.method === "bearer" && !auth.token) {
      return "the active profile's bearer token is empty";
    }
    if (auth.method === "custom" && Object.keys(auth.headers).length === 0) {
      return "the active profile has no custom headers";
    }
    if (auth.method === "oauth") {
      const hasToken = !!getBearerToken() || !!loadOAuthTokens().accessToken;
      if (!hasToken) {
        return "the active profile uses OAuth but no token is signed in";
      }
    }
    return null;
  }

  async function startRun(test: Test, mode: "auto" | "step" = "auto") {
    onOpenChange(false);
    const studio = useStudioStore.getState();
    const artifacts = createArtifactCollector();
    const engine = createEngine({
      store: makeEngineStore(),
      iframe: () => useStudioStore.getState()._iframeRef,
      bridge: createBridgeClient(() => useStudioStore.getState()._iframeRef),
      drivers: [chromeDriver, mcpDriver, widgetDriver],
      artifacts,
      mode,
    });
    runtime.begin(
      test.name,
      test.description,
      test.session.timeline.length,
      mode,
      {
        abort: () => engine.abort(),
        next: () => engine.next(),
        setMode: (m) => engine.setMode(m),
      },
    );
    try {
      const result = await engine.run(test, (p) =>
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

  async function handleRun(name: string, mode: "auto" | "step" = "auto") {
    setBusyName(name);
    try {
      const test = await getTest(name);
      const studio = useStudioStore.getState();
      const missing = describeMissingAuth(test);
      if (missing) {
        setPendingAuth({ test, mode, reason: missing });
        return;
      }
      if (studio.strictMode && hasWidgetDom(test)) {
        setPendingRun({ test, mode });
        return;
      }
      await startRun(test, mode);
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
                                ? loaded.session.timeline.filter(
                                    (e) =>
                                      !hideObservations || !isObservation(e),
                                  ).length
                                : null
                            }
                            hideObservations={hideObservations}
                            savedAt={t.modifiedMs}
                          />
                          {t.profileId && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              profile:{" "}
                              <span className="font-mono">
                                {profilesById.get(t.profileId) ?? t.profileId}
                              </span>
                            </div>
                          )}
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
                            timeline={loaded.session.timeline}
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
      {pendingAuth && (
        <TestAuthPreconditionDialog
          open={true}
          testName={pendingAuth.test.name}
          profileName={
            useStudioStore
              .getState()
              .profiles.find(
                (p) => p.id === useStudioStore.getState().activeProfileId,
              )?.name ?? "(none)"
          }
          reason={pendingAuth.reason}
          onCancel={() => setPendingAuth(null)}
          onConfigure={() => {
            setPendingAuth(null);
            onOpenChange(false);
            useStudioStore.getState().setAuthOpen(true);
          }}
          onProceed={async () => {
            const { test, mode } = pendingAuth;
            setPendingAuth(null);
            const studio = useStudioStore.getState();
            if (studio.strictMode && hasWidgetDom(test)) {
              setPendingRun({ test, mode });
              return;
            }
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
