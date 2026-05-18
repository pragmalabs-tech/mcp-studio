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
  PlayCircle,
  Settings,
  StepForward,
  Square,
  Tag as TagIcon,
  Trash2,
  XCircle,
  XIcon,
  RefreshCw,
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
import {
  listTests,
  getTrace,
  deleteTest,
  saveTrace,
  saveRunResult,
  updateRunResultEntry,
} from "@/lib/tests/api";
import { collectTags, normalizeTags } from "@/lib/tests/tags";
import { runBatch, type BatchTraceInput } from "@/lib/core/batch";
import {
  newRunId,
  summarize,
  type RunFile,
} from "@/lib/tests/run-result-schema";
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
import { applyCompareMode, applyRules } from "@/lib/core/trace-edits";
import { buildRuntimeDrivers } from "@/lib/core/runtime";
import { createBridgeClient } from "@/lib/recorder/bridge-client";
import { TestPreconditionDialog } from "@/components/studio/test-precondition-dialog";
import { TestInspectorDialog } from "@/components/studio/test-inspector";
import { TraceModal } from "@/lib/core/views/trace-modal";
import type { Step, Trace, TraceRules, Verdict } from "@/lib/core/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RunRecord {
  id: string;
  /** Id of the persisted RunFile this entry was saved into; needed so the
   *  trace viewer can patch the on-disk run-result when the user applies
   *  a rule. Optional for records produced before this field existed. */
  runFileId?: string;
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

function ActionCountLabel({
  total,
  savedAt,
}: {
  total: number;
  savedAt: number;
}) {
  return (
    <div className="text-[10px] text-muted-foreground mt-0.5">
      {`${total} action${total === 1 ? "" : "s"}`}
      {" · "}
      saved {formatTime(savedAt)}
    </div>
  );
}

export function ActionList({
  steps,
  selectedIdx,
  onSelect,
}: {
  steps: readonly Step[];
  /** Original-trace index of the selected step. When undefined, rows
   *  render as static (no hover/selected states). */
  selectedIdx?: number;
  /** Click handler receives the step index in `steps`. */
  onSelect?: (idx: number) => void;
}) {
  if (steps.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground italic">
        Empty trace.
      </p>
    );
  }
  const selectable = !!onSelect;
  return (
    <div className="py-1">
      {steps.map((step, originalIdx) => {
        const summary = actionSummary(step.action);
        const expects = actionExpectation(step.action);
        const isSelected = selectable && selectedIdx === originalIdx;
        const className = `pl-3 pr-4 py-1.5 text-[11px] font-mono flex items-start gap-2 border-l-2 ${
          selectable
            ? `w-full text-left transition-colors ${
                isSelected
                  ? "bg-primary/15 border-l-primary text-foreground"
                  : "border-l-transparent hover:bg-secondary/40"
              }`
            : "border-l-transparent"
        }`;
        const content = (
          <>
            <span className="text-muted-foreground/60 w-8 shrink-0 text-right pt-0.5">
              {originalIdx + 1}
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
          </>
        );
        return selectable ? (
          <button
            key={originalIdx}
            type="button"
            onClick={() => onSelect?.(originalIdx)}
            className={className}
          >
            {content}
          </button>
        ) : (
          <div key={originalIdx} className={className}>
            {content}
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
    /** Id of the persisted RunFile this result was saved into. Set on the
     *  in-session standalone path and on history reopens; null when we
     *  have no on-disk record to update. Used to double-write rule edits
     *  back to the run-result file alongside the test fixture. */
    runFileId: string | null;
    recorded: Trace;
    replayed: Trace;
    verdict: Verdict;
  } | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  // In-memory log of replays for this session. Resets on page reload.
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadedTests, setLoadedTests] = useState<Record<string, Trace>>({});
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TestSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [editingTagsFor, setEditingTagsFor] = useState<TestSummary | null>(
    null,
  );
  const [viewingRulesFor, setViewingRulesFor] = useState<TestSummary | null>(
    null,
  );
  /** Test currently open in the inspector dialog (the pre-run preview).
   *  Set when the user clicks Preview on a row; trace is read from
   *  `loadedTests` so we don't re-fetch. */
  const [inspectingTest, setInspectingTest] = useState<TestSummary | null>(
    null,
  );
  const [batchState, setBatchState] = useState<{
    ctrl: AbortController;
    current: number;
    total: number;
    currentName: string;
  } | null>(null);
  const [batchResult, setBatchResult] = useState<{
    title: string;
    description: string;
    variant: "success" | "error";
  } | null>(null);
  const [confirmRunAll, setConfirmRunAll] = useState(false);

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
    mode: "auto" | "step" = "auto",
  ) {
    onOpenChange(false);
    const startedAt = Date.now();
    const runStart = performance.now();
    const ctrl = new AbortController();
    const store = useStudioStore.getState();
    store.setRunState({
      testName: recorded.name,
      mode,
      currentStep: -1,
      totalSteps: recorded.steps.length,
      currentAction: null,
      ctrl,
      nextResolver: null,
    });
    // Signal "replay in progress" so the studio store's recording-time
    // auto-side-effects (deferred loadWidget/applyMock from select / theme
    // / locale / displayMode / strictMode setters) skip themselves — the
    // engine drives renders explicitly via widget.render and shouldn't
    // race against a 50ms timer firing a fresh readResource.
    store.setStudioMode("test");
    try {
      const bridge = createBridgeClient(
        () => useStudioStore.getState()._iframeRef,
      );
      const replayed = await runEngine(recorded, {
        signal: ctrl.signal,
        drivers: buildRuntimeDrivers({
          dispatch: async (selectors, kind, _extra) => {
            await bridge.dispatch(
              { kind: kind as never, selectors } as never,
              2_000,
            );
          },
          awaitRenderComplete: async (timeoutMs) => {
            await bridge.awaitRenderComplete(timeoutMs);
          },
        }),
        onStepStart: (i, action, total) =>
          useStudioStore.getState().patchRunState({
            currentStep: i,
            currentAction: action,
            totalSteps: total,
          }),
        beforeStep: () =>
          new Promise<void>((resolve) => {
            // Read latest mode synchronously from the store — survives
            // mid-run mode changes (Auto from here).
            if (useStudioStore.getState().runState?.mode !== "step") {
              resolve();
              return;
            }
            useStudioStore.getState().patchRunState({ nextResolver: resolve });
          }),
      });
      if (ctrl.signal.aborted) {
        return;
      }
      const verdict = diff(recorded, replayed, resolveRules(recorded));
      const finishedAt = Date.now();
      const runFileId = newRunId(startedAt);
      setResultData({ testFsName, runFileId, recorded, replayed, verdict });
      setResultOpen(true);
      setRunHistory((prev) =>
        [
          {
            id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            runFileId,
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
      // Persist as a standalone run-result so it joins the same Runs catalog
      // as Run-all batches. Fire-and-forget - a save failure shouldn't
      // disrupt the in-flight UI.
      const studio = useStudioStore.getState();
      const standaloneFile: RunFile = {
        id: runFileId,
        runType: "standalone",
        startedAt,
        finishedAt,
        filter: { tags: [] },
        env: {
          proxyUrl: studio.proxyUrl,
          studioVersion: "0.1.0",
          platform: studio.platform,
          strict: studio.strictMode,
          profileId: studio.activeProfileId ?? undefined,
        },
        summary: {
          total: 1,
          passed: verdict.ok ? 1 : 0,
          failed: verdict.ok ? 0 : 1,
          errored: 0,
          durationMs: performance.now() - runStart,
        },
        results: [
          {
            testName: recorded.name,
            testFsName,
            status: verdict.ok ? "passed" : "failed",
            durationMs: performance.now() - runStart,
            recorded,
            replayed,
            verdict,
          },
        ],
      };
      void saveRunResult(standaloneFile).catch(() => {
        /* non-critical; standalone result is still visible in History */
      });
    } catch (e) {
      alert(`Test failed to run: ${(e as Error).message}`);
    } finally {
      useStudioStore.getState().setRunState(null);
      useStudioStore.getState().setStudioMode("normal");
    }
  }

  async function runAllFiltered() {
    if (filteredTests.length === 0 || batchState) return;
    const startedAt = Date.now();
    const ctrl = new AbortController();
    setBatchState({
      ctrl,
      current: 0,
      total: filteredTests.length,
      currentName: "",
    });

    // Load every trace upfront. If a load fails we mark that test as errored
    // and keep going; the engine will skip it.
    const inputs: BatchTraceInput[] = [];
    const loadErrors: Array<{ name: string; error: string }> = [];
    for (const t of filteredTests) {
      if (ctrl.signal.aborted) break;
      try {
        const trace = await getTrace(t.name);
        inputs.push({ testFsName: t.name, trace });
      } catch (e) {
        loadErrors.push({
          name: t.name,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (ctrl.signal.aborted) {
      setBatchState(null);
      return;
    }

    const bridge = createBridgeClient(
      () => useStudioStore.getState()._iframeRef,
    );

    // See startRun above — flip studioMode for the duration of the batch
    // so per-test replays don't trigger the deferred auto-load setters.
    useStudioStore.getState().setStudioMode("test");
    try {
      const results = await runBatch(inputs, {
        signal: ctrl.signal,
        buildDeps: () => ({
          drivers: buildRuntimeDrivers({
            dispatch: async (selectors, kind, _extra) => {
              await bridge.dispatch(
                { kind: kind as never, selectors } as never,
                2_000,
              );
            },
            awaitRenderComplete: async (timeoutMs) => {
              await bridge.awaitRenderComplete(timeoutMs);
            },
          }),
        }),
        onTestStart: (i, input, total) =>
          setBatchState({
            ctrl,
            current: i + 1,
            total,
            currentName: input.trace.name,
          }),
      });

      if (ctrl.signal.aborted) {
        setBatchState(null);
        return;
      }

      const finishedAt = Date.now();
      const studio = useStudioStore.getState();
      const summary = summarize(results);
      const id = newRunId(startedAt);
      const file: RunFile = {
        id,
        runType: "batch",
        startedAt,
        finishedAt,
        filter: { tags: Array.from(activeTags) },
        env: {
          proxyUrl: studio.proxyUrl,
          studioVersion: "0.1.0",
          platform: studio.platform,
          strict: studio.strictMode,
          profileId: studio.activeProfileId ?? undefined,
        },
        summary,
        results,
      };
      try {
        await saveRunResult(file);
        const parts = [
          `${summary.passed} passed`,
          `${summary.failed} failed`,
          `${summary.errored} errored`,
        ];
        if (loadErrors.length) {
          parts.push(`${loadErrors.length} could not be loaded`);
        }
        setBatchResult({
          title: "Run saved",
          description: `${parts.join(", ")}. Open the Runs panel to view.`,
          variant: "success",
        });
      } catch (e) {
        setBatchResult({
          title: "Run completed but failed to save",
          description: (e as Error).message,
          variant: "error",
        });
      }
    } catch (e) {
      setBatchResult({
        title: "Batch run failed",
        description: (e as Error).message,
        variant: "error",
      });
    } finally {
      setBatchState(null);
      useStudioStore.getState().setStudioMode("normal");
    }
  }

  function openRun(run: RunRecord) {
    setResultData({
      testFsName: run.testFsName ?? null,
      runFileId: run.runFileId ?? null,
      recorded: run.recorded,
      replayed: run.replayed,
      verdict: run.verdict,
    });
    setResultOpen(true);
  }

  /** Persist new rules on the recorded trace, recompute the verdict
   *  against the existing replayed trace (no re-run), and refresh the
   *  open viewer. Double-writes to the test fixture (live contract for
   *  future runs) AND to the run-result file the user is viewing (so
   *  reopening shows the applied rule). Returns a promise so the UI can
   *  disable buttons. */
  async function handleRulesChange(nextRules: TraceRules) {
    if (!resultData) return;
    const { testFsName, runFileId, replayed } = resultData;
    const { recorded: nextRecorded, verdict: nextVerdict } = applyRules(
      resultData.recorded,
      replayed,
      nextRules,
    );
    setResultData({
      testFsName,
      runFileId,
      recorded: nextRecorded,
      replayed,
      verdict: nextVerdict,
    });
    await persistRuleEdit(
      testFsName,
      runFileId,
      nextRecorded,
      nextVerdict,
      "rules",
    );
  }

  /** Set the compare strategy for one step on the recorded trace,
   *  re-run the differ against the existing replay, and persist. */
  async function handleCompareChange(
    stepIndex: number,
    mode: "exact" | "shape",
  ) {
    if (!resultData) return;
    const { testFsName, runFileId, replayed } = resultData;
    const { recorded: nextRecorded, verdict: nextVerdict } = applyCompareMode(
      resultData.recorded,
      replayed,
      stepIndex,
      mode,
    );
    setResultData({
      testFsName,
      runFileId,
      recorded: nextRecorded,
      replayed,
      verdict: nextVerdict,
    });
    await persistRuleEdit(
      testFsName,
      runFileId,
      nextRecorded,
      nextVerdict,
      "compare mode",
    );
    if (testFsName) {
      setLoadedTests((prev) =>
        testFsName in prev ? { ...prev, [testFsName]: nextRecorded } : prev,
      );
    }
  }

  /** Shared persistence for rule and compare-mode edits made from the
   *  trace viewer. Writes to the test fixture (so future runs see the
   *  change) AND to the run-result file the user is viewing (so reopen
   *  is consistent). When testFsName is missing we have no fixture to
   *  update; warn the user so the silent-skip case is visible. */
  async function persistRuleEdit(
    testFsName: string | null,
    runFileId: string | null,
    nextRecorded: Trace,
    nextVerdict: Verdict,
    label: string,
  ) {
    if (!testFsName) {
      setError(
        `Applied ${label} to this run only - no linked test fixture to update. Future runs of this test won't see the change.`,
      );
      return;
    }
    try {
      await saveTrace(testFsName, nextRecorded);
    } catch (e) {
      setError(`Failed to persist ${label}: ${(e as Error).message}`);
      return;
    }
    if (runFileId) {
      try {
        await updateRunResultEntry(
          runFileId,
          testFsName,
          nextRecorded,
          nextVerdict,
        );
      } catch (e) {
        setError(
          `Saved ${label} to test fixture but failed to update this run-result: ${(e as Error).message}`,
        );
      }
    }
  }

  /** Load a test's trace if not already cached, then open the Preview
   *  inspector. The inspector reads from `loadedTests[name]`. */
  async function openPreview(test: TestSummary) {
    if (!loadedTests[test.name]) {
      setLoadingName(test.name);
      try {
        const trace = await getTrace(test.name);
        setLoadedTests((prev) => ({ ...prev, [test.name]: trace }));
      } catch (e) {
        setError((e as Error).message);
        return;
      } finally {
        setLoadingName(null);
      }
    }
    setInspectingTest(test);
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
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRunAll(true)}
                  disabled={
                    filteredTests.length === 0 || !!batchState || loading
                  }
                  title={
                    filteredTests.length === 0
                      ? "No tests match the current filter"
                      : `Run all ${filteredTests.length} filtered tests and save a run result`
                  }
                >
                  <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
                  Run all ({filteredTests.length})
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
          {batchState && (
            <div className="px-4 py-2 text-xs border-b flex items-center gap-2 bg-muted/30">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span className="truncate">
                Running {batchState.current}/{batchState.total}
                {batchState.currentName ? `: ${batchState.currentName}` : ""}
              </span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => batchState.ctrl.abort()}
                title="Stop the batch - results are discarded"
              >
                <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
                Stop
              </Button>
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
                return (
                  <div key={t.name} className="border-b border-border/30">
                    <div className="px-4 py-3 hover:bg-secondary/20">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => openPreview(t)}
                          className="min-w-0 flex-1 text-left"
                          title="Preview inputs and assertions before running"
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
                            onClick={() => openPreview(t)}
                            disabled={
                              busyName === t.name || loadingName === t.name
                            }
                            title="Preview inputs and assertions before running"
                          >
                            <Eye className="h-3.5 w-3.5 mr-1.5" />
                            Preview
                          </Button>
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
        open={confirmRunAll}
        onOpenChange={(v) => {
          if (!v) setConfirmRunAll(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-blue-500/10 text-blue-400">
              <PlayCircle />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Run all {filteredTests.length} filtered test
              {filteredTests.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tests run sequentially in the foreground iframe. The run can take
              a while depending on each test's actions, and you can click Stop
              at any time. The result is saved to{" "}
              <span className="font-mono">~/.mcp-studio/run-results/</span> when
              the batch finishes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRunAll(false);
                void runAllFiltered();
              }}
            >
              Run all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!batchResult}
        onOpenChange={(v) => {
          if (!v) setBatchResult(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia
              className={
                batchResult?.variant === "success"
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }
            >
              {batchResult?.variant === "success" ? (
                <CheckCircle2 />
              ) : (
                <XCircle />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>{batchResult?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {batchResult?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setBatchResult(null)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      <TestInspectorDialog
        open={inspectingTest !== null}
        onOpenChange={(v) => {
          if (!v) setInspectingTest(null);
        }}
        trace={
          inspectingTest ? (loadedTests[inspectingTest.name] ?? null) : null
        }
        onRun={
          inspectingTest
            ? (mode) => handleRun(inspectingTest.name, mode)
            : undefined
        }
      />
    </Dialog>
  );
}
