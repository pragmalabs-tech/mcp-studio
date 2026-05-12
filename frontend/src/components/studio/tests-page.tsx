import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CheckCircle2,
  ChevronRight,
  Download,
  FlaskConical,
  History as HistoryIcon,
  Loader2,
  Play,
  Settings,
  StepForward,
  Tag as TagIcon,
  Trash2,
  XCircle,
  XIcon,
  RefreshCw,
  EyeOff,
  Eye,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import { RulesEditor } from "@/components/studio/rules-editor";
import { listTests, getTrace, deleteTest, saveTrace } from "@/lib/tests/api";
import { collectTags, normalizeTags } from "@/lib/tests/tags";
import {
  actionExpectation,
  actionLabel,
  actionSummary,
} from "@/lib/core/action-format";
import type { TestSummary } from "@/lib/recorder/schema";
import { useStudioStore } from "@/lib/studio/store";
import { run as runEngine } from "@/lib/core/engine";
import { diff } from "@/lib/core/differ";
import { resolveRules } from "@/lib/core/rules";
import { buildRuntimeDrivers } from "@/lib/core/runtime";
import { createBridgeClient } from "@/lib/engine/bridge-client";
import { TestPreconditionDialog } from "@/components/studio/test-precondition-dialog";
import { TraceModal } from "@/lib/core/views/trace-modal";
import type {
  Action,
  Step,
  Trace,
  TraceRules,
  Verdict,
} from "@/lib/core/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RunRecord {
  id: string;
  testName: string;
  /** Filesystem name to persist rule edits against. Optional for
   *  records originating from sources that don't track it. */
  testFsName?: string;
  ranAt: number;
  recorded: Trace;
  replayed: Trace;
  verdict: Verdict;
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
      {visible.map((step, i) => {
        const summary = actionSummary(step.action);
        const expects = actionExpectation(step.action);
        return (
          <div
            key={i}
            className="px-4 py-1.5 text-[11px] font-mono flex items-start gap-2"
          >
            <span className="text-muted-foreground/60 w-8 shrink-0 text-right pt-0.5">
              {i + 1}
            </span>
            <span className="text-foreground w-40 shrink-0 font-semibold truncate pt-0.5">
              {actionLabel(step.action)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-muted-foreground truncate">
                {summary || (
                  <span className="italic opacity-60">(no detail)</span>
                )}
              </div>
              {expects && (
                <div className="text-muted-foreground/60 truncate text-[10px] mt-0.5">
                  {expects}
                </div>
              )}
            </div>
            {step.compare === "shape" && (
              <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-yellow-400/15 text-yellow-200 shrink-0 mt-0.5">
                shape
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunHistoryList({
  runs,
  onOpen,
}: {
  runs: readonly RunRecord[];
  onOpen(run: RunRecord): void;
}) {
  if (runs.length === 0) {
    return (
      <p className="text-center text-muted-foreground text-xs py-12 px-6">
        No runs yet this session. Run a test to log it here.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/30">
      {runs.map((r) => {
        const ok = r.verdict.ok;
        return (
          <li
            key={r.id}
            className="px-4 py-3 hover:bg-secondary/20 cursor-pointer flex items-center gap-3"
            onClick={() => onOpen(r)}
          >
            {ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{r.testName}</div>
              <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                {new Date(r.ranAt).toLocaleTimeString()} ·{" "}
                {r.verdict.drifts.length} drifts · {r.replayed.steps.length}{" "}
                steps
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
          </li>
        );
      })}
    </ul>
  );
}

function EditTagsDialog({
  test,
  suggestions,
  onClose,
  onSaved,
}: {
  test: TestSummary;
  suggestions: readonly string[];
  onClose: () => void;
  onSaved: (next: string[]) => void;
}) {
  const [tags, setTags] = useState<string[]>(test.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const trace = await getTrace(test.name);
      const next = normalizeTags(tags);
      await saveTrace(test.name, {
        ...trace,
        tags: next.length > 0 ? next : undefined,
      });
      onSaved(next);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit tags</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {test.displayName ?? test.name}
            </Label>
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={suggestions}
              placeholder="e.g. smoke, auth"
              autoFocus
            />
          </div>
          {error && (
            <p className="text-xs text-destructive font-mono">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewRulesDialog({
  test,
  onClose,
}: {
  test: TestSummary;
  onClose: () => void;
}) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTrace(test.name)
      .then((t) => {
        if (!cancelled) setTrace(t);
      })
      .catch((e) => {
        if (!cancelled) setLoadError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [test.name]);

  async function handleRulesChange(nextRules: TraceRules) {
    if (!trace) return;
    const next: Trace = { ...trace, rules: nextRules };
    setTrace(next);
    setSaving(true);
    try {
      await saveTrace(test.name, next);
    } catch (e) {
      setLoadError(`Failed to save rules: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Rules · {test.displayName ?? test.name}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6">
          {loadError && (
            <p className="text-xs text-destructive font-mono px-6 py-2">
              {loadError}
            </p>
          )}
          {!trace && !loadError && (
            <p className="text-xs text-muted-foreground italic px-6 py-4">
              Loading rules…
            </p>
          )}
          {trace && <RulesEditor trace={trace} onChange={handleRulesChange} />}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TestsPage({ open, onOpenChange }: Props) {
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [pendingRun, setPendingRun] = useState<{
    test: Trace;
    fsName: string;
    mode: "auto" | "step";
  } | null>(null);
  const [resultData, setResultData] = useState<{
    /** Filesystem name of the saved test, used to persist rule edits.
     *  Null when viewing a history entry whose fs-name we no longer track. */
    testFsName: string | null;
    recorded: Trace;
    replayed: Trace;
    verdict: Verdict;
  } | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  // In-memory log of replays for this session. Resets on page reload.
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedTests, setLoadedTests] = useState<Record<string, Trace>>({});
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [hideObservations, setHideObservations] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<TestSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [editingTagsFor, setEditingTagsFor] = useState<TestSummary | null>(
    null,
  );
  const [viewingRulesFor, setViewingRulesFor] = useState<TestSummary | null>(
    null,
  );

  const allTags = useMemo(() => collectTags(tests), [tests]);
  const filteredTests = useMemo(() => {
    if (activeTags.size === 0) return tests;
    return tests.filter((t) =>
      (t.tags ?? []).some((tag) => activeTags.has(tag)),
    );
  }, [tests, activeTags]);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

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

  async function startRun(
    recorded: Trace,
    testFsName: string,
    _mode: "auto" | "step" = "auto",
  ) {
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
      const verdict = diff(recorded, replayed, resolveRules(recorded));
      setResultData({ testFsName, recorded, replayed, verdict });
      setResultOpen(true);
      setRunHistory((prev) =>
        [
          {
            id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            testName: recorded.name,
            testFsName,
            ranAt: Date.now(),
            recorded,
            replayed,
            verdict,
          },
          ...prev,
        ].slice(0, 50),
      );
    } catch (e) {
      alert(`Test failed to run: ${(e as Error).message}`);
    }
  }

  function openRun(run: RunRecord) {
    setResultData({
      testFsName: run.testFsName ?? null,
      recorded: run.recorded,
      replayed: run.replayed,
      verdict: run.verdict,
    });
    setResultOpen(true);
  }

  /** Persist new rules on the recorded trace, recompute the verdict
   *  against the existing replayed trace (no re-run), and refresh the
   *  open viewer. Returns a promise so the UI can disable buttons. */
  async function handleRulesChange(nextRules: TraceRules) {
    if (!resultData) return;
    const { testFsName, recorded, replayed } = resultData;
    const nextRecorded: Trace = { ...recorded, rules: nextRules };
    const nextVerdict = diff(
      nextRecorded,
      replayed,
      resolveRules(nextRecorded),
    );
    setResultData({
      testFsName,
      recorded: nextRecorded,
      replayed,
      verdict: nextVerdict,
    });
    if (testFsName) {
      try {
        await saveTrace(testFsName, nextRecorded);
      } catch (e) {
        setError(`Failed to persist rules: ${(e as Error).message}`);
      }
    }
  }

  /** Set the compare strategy for one step on the recorded trace,
   *  re-run the differ against the existing replay, and persist. */
  async function handleCompareChange(
    stepIndex: number,
    mode: "exact" | "shape",
  ) {
    if (!resultData) return;
    const { testFsName, recorded, replayed } = resultData;
    const nextSteps = recorded.steps.map((s, i) =>
      i === stepIndex
        ? { ...s, compare: mode === "exact" ? undefined : mode }
        : s,
    );
    const nextRecorded: Trace = { ...recorded, steps: nextSteps };
    const nextVerdict = diff(
      nextRecorded,
      replayed,
      resolveRules(nextRecorded),
    );
    setResultData({
      testFsName,
      recorded: nextRecorded,
      replayed,
      verdict: nextVerdict,
    });
    if (testFsName) {
      try {
        await saveTrace(testFsName, nextRecorded);
        setLoadedTests((prev) =>
          testFsName in prev ? { ...prev, [testFsName]: nextRecorded } : prev,
        );
      } catch (e) {
        setError(`Failed to persist compare mode: ${(e as Error).message}`);
      }
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
        setPendingRun({ test: trace, fsName: name, mode });
        return;
      }
      await startRun(trace, name, mode);
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
              {showHistory ? "Run history" : "Tests"}
              <span className="text-xs font-normal text-muted-foreground">
                {showHistory
                  ? runHistory.length
                  : activeTags.size > 0
                    ? `${filteredTests.length} / ${tests.length}`
                    : tests.length}
              </span>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory((v) => !v)}
                title={
                  showHistory
                    ? "Back to tests"
                    : "Show this session's replay runs"
                }
              >
                {showHistory ? (
                  <>
                    <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
                    Tests
                    <span className="ml-1 text-muted-foreground">
                      ({tests.length})
                    </span>
                  </>
                ) : (
                  <>
                    <HistoryIcon className="h-3.5 w-3.5 mr-1.5" />
                    History
                    {runHistory.length > 0 && (
                      <span className="ml-1 text-muted-foreground">
                        ({runHistory.length})
                      </span>
                    )}
                  </>
                )}
              </Button>
              {!showHistory && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHideObservations((v) => !v)}
                  title={
                    hideObservations
                      ? "Showing inputs only - click to also show observations"
                      : "Showing all actions - click to hide observations"
                  }
                >
                  {hideObservations ? (
                    <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {hideObservations ? "Inputs only" : "All actions"}
                </Button>
              )}
              {!showHistory && (
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
              )}
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
          {!showHistory && allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border/30 shrink-0">
              <span className="text-[10px] text-muted-foreground font-medium">
                Filter:
              </span>
              {allTags.map((tag) => {
                const active = activeTags.has(tag);
                return (
                  <Badge
                    key={tag}
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer text-[10px] px-1.5 py-0"
                    render={
                      <button type="button" onClick={() => toggleTag(tag)} />
                    }
                  >
                    {tag}
                  </Badge>
                );
              })}
              {activeTags.size > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
                  onClick={() => setActiveTags(new Set())}
                >
                  Clear
                </button>
              )}
            </div>
          )}
          <div className="flex-1 overflow-y-auto min-h-0">
            {showHistory ? (
              <RunHistoryList runs={runHistory} onOpen={openRun} />
            ) : !loading && tests.length === 0 ? (
              <p className="text-center text-muted-foreground text-xs py-12 px-6">
                No tests saved yet. Open Action history (clock icon), use Mark
                start / Mark end to slice the log, then Save.
              </p>
            ) : !loading && filteredTests.length === 0 ? (
              <p className="text-center text-muted-foreground text-xs py-12 px-6">
                No tests match the active tag filter.
              </p>
            ) : (
              filteredTests.map((t) => {
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
                          {t.tags && t.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {t.tags.map((tag) => (
                                <Badge
                                  key={tag}
                                  variant={
                                    activeTags.has(tag)
                                      ? "default"
                                      : "secondary"
                                  }
                                  className="text-[10px] px-1.5 py-0 cursor-pointer"
                                  render={
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleTag(tag);
                                      }}
                                    />
                                  }
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
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
                            onClick={() => setEditingTagsFor(t)}
                            disabled={busyName === t.name}
                            title="Edit tags"
                          >
                            <TagIcon className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setViewingRulesFor(t)}
                            disabled={busyName === t.name}
                            title="View assertion rules"
                          >
                            <Settings className="h-3.5 w-3.5" />
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
            const { test, fsName, mode } = pendingRun;
            setPendingRun(null);
            useStudioStore.getState().setStrictMode(false);
            await new Promise((r) => setTimeout(r, 100));
            await startRun(test, fsName, mode);
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
        onRulesChange={handleRulesChange}
        onCompareChange={handleCompareChange}
      />
      {editingTagsFor && (
        <EditTagsDialog
          test={editingTagsFor}
          suggestions={allTags}
          onClose={() => setEditingTagsFor(null)}
          onSaved={(next) => {
            setTests((prev) =>
              prev.map((t) =>
                t.name === editingTagsFor.name
                  ? { ...t, tags: next.length > 0 ? next : undefined }
                  : t,
              ),
            );
          }}
        />
      )}
      {viewingRulesFor && (
        <ViewRulesDialog
          test={viewingRulesFor}
          onClose={() => setViewingRulesFor(null)}
        />
      )}
    </Dialog>
  );
}
