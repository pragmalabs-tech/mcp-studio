import { useCallback, useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Play,
  PlayCircle,
  RefreshCw,
  Trash2,
  XCircle,
  XIcon,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listRunResults,
  getRunResult,
  deleteRunResult,
  saveTrace,
  updateRunResultEntry,
} from "@/lib/tests/api";
import { diff as runDiff } from "@/lib/core/differ";
import { resolveRules } from "@/lib/core/rules";
import { applyCompareMode, applyRules } from "@/lib/core/trace-edits";
import { TraceModal } from "@/lib/core/views/trace-modal";
import type {
  RunFile,
  RunFileSummary,
  RunResultEntry,
} from "@/lib/tests/run-result-schema";
import type { Trace, Verdict } from "@/lib/core/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(ms: number | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function RunsPage({ open, onOpenChange }: Props) {
  const [runs, setRuns] = useState<RunFileSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<RunFile | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<RunResultEntry | null>(
    null,
  );
  // Edits to rules / compare mode from this viewer are buffered: the
  // current `selectedEntry.recorded` reflects pending changes, `pristine`
  // is the original (for Discard), and `dirty` gates the banner.
  const [pristine, setPristine] = useState<Trace | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busyDelete, setBusyDelete] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const selectEntry = useCallback((entry: RunResultEntry | null) => {
    setSelectedEntry(entry);
    setPristine(entry?.recorded ?? null);
    setDirty(false);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listRunResults();
      list.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
      setRuns(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const openRun = useCallback(
    async (id: string) => {
      setOpenId(id);
      setLoadingDetail(true);
      selectEntry(null);
      try {
        setOpenFile(await getRunResult(id));
      } catch (e) {
        setError((e as Error).message);
        setOpenId(null);
      } finally {
        setLoadingDetail(false);
      }
    },
    [selectEntry],
  );

  const closeDetail = useCallback(() => {
    setOpenId(null);
    setOpenFile(null);
    selectEntry(null);
  }, [selectEntry]);

  async function handleDelete(id: string) {
    setBusyDelete(id);
    try {
      await deleteRunResult(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      if (openId === id) closeDetail();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyDelete(null);
    }
  }

  // Errored entries don't have a meaningful replay trace - show the error
  // message instead of the diff viewer (where recorded === replayed would
  // render as "no drifts" but FAIL, which is misleading).
  const showErrorDialog = selectedEntry?.status === "errored";
  const modalRecorded: Trace | null =
    selectedEntry && !showErrorDialog ? selectedEntry.recorded : null;
  const modalReplayed: Trace | null =
    selectedEntry && !showErrorDialog ? selectedEntry.replayed : null;
  const modalVerdict: Verdict | null =
    selectedEntry && !showErrorDialog ? selectedEntry.verdict : null;

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
              {openFile ? `Run ${openFile.id}` : "Run results"}
              {!openFile && (
                <span className="text-xs font-normal text-muted-foreground">
                  {runs.length}
                </span>
              )}
            </DialogPrimitive.Title>
            <div className="flex items-center gap-1">
              {openFile && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeDetail}
                  title="Back to list"
                >
                  Back
                </Button>
              )}
              {!openFile && (
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
          <div className="flex-1 overflow-y-auto">
            {!openFile && !loading && runs.length === 0 && (
              <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                No runs yet. Run any test from the Tests panel.
              </div>
            )}
            {!openFile &&
              runs.map((r) => (
                <RunListRow
                  key={r.id}
                  summary={r}
                  expanded={expandedId === r.id}
                  onToggle={() =>
                    setExpandedId((prev) => (prev === r.id ? null : r.id))
                  }
                  onOpen={() => openRun(r.id)}
                  onDelete={() => handleDelete(r.id)}
                  busy={busyDelete === r.id}
                />
              ))}
            {openFile && loadingDetail && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {openFile && !loadingDetail && (
              <RunDetail file={openFile} onSelectEntry={selectEntry} />
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
      <TraceModal
        recorded={modalRecorded}
        replayed={modalReplayed}
        verdict={modalVerdict}
        open={selectedEntry !== null && !showErrorDialog}
        onOpenChange={(o) => {
          if (!o) selectEntry(null);
        }}
        onRulesChange={(nextRules) => {
          if (!selectedEntry) return;
          const { recorded: nextRecorded, verdict: nextVerdict } = applyRules(
            selectedEntry.recorded,
            selectedEntry.replayed,
            nextRules,
          );
          setSelectedEntry({
            ...selectedEntry,
            recorded: nextRecorded,
            verdict: nextVerdict,
          });
          setDirty(true);
        }}
        onCompareChange={(stepIndex, mode) => {
          if (!selectedEntry) return;
          const { recorded: nextRecorded, verdict: nextVerdict } =
            applyCompareMode(
              selectedEntry.recorded,
              selectedEntry.replayed,
              stepIndex,
              mode,
            );
          setSelectedEntry({
            ...selectedEntry,
            recorded: nextRecorded,
            verdict: nextVerdict,
          });
          setDirty(true);
        }}
        unsavedChanges={
          dirty && selectedEntry
            ? {
                onApply: async () => {
                  if (!selectedEntry.testFsName) {
                    setError(
                      "Cannot apply: this run has no source test (testFsName missing).",
                    );
                    return;
                  }
                  if (!openFile) {
                    setError("Cannot apply: no run file open.");
                    return;
                  }
                  try {
                    await saveTrace(
                      selectedEntry.testFsName,
                      selectedEntry.recorded,
                    );
                  } catch (e) {
                    setError(
                      `Failed to apply changes: ${(e as Error).message}`,
                    );
                    return;
                  }
                  try {
                    await updateRunResultEntry(
                      openFile.id,
                      selectedEntry.testFsName,
                      selectedEntry.recorded,
                      selectedEntry.verdict,
                    );
                  } catch (e) {
                    setError(
                      `Saved to test fixture but failed to update this run-result: ${(e as Error).message}`,
                    );
                    return;
                  }
                  setPristine(selectedEntry.recorded);
                  setDirty(false);
                },
                onDiscard: () => {
                  if (!pristine) return;
                  const restoredVerdict = runDiff(
                    pristine,
                    selectedEntry.replayed,
                    resolveRules(pristine),
                  );
                  setSelectedEntry({
                    ...selectedEntry,
                    recorded: pristine,
                    verdict: restoredVerdict,
                  });
                  setDirty(false);
                },
              }
            : undefined
        }
      />
      <AlertDialog
        open={showErrorDialog}
        onOpenChange={(o) => {
          if (!o) selectEntry(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-yellow-500/10 text-yellow-500">
              <AlertTriangle />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {selectedEntry?.testName} errored during replay
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block font-mono text-xs whitespace-pre-wrap break-words">
                {selectedEntry?.error ?? "Unknown error"}
              </span>
              <span className="block mt-3 text-xs text-muted-foreground">
                No drift to compare - the engine threw before completing the
                replay. The recorded trace is left as-is; re-run the test
                individually to see partial state.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => selectEntry(null)}>
              Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function RunListRow({
  summary,
  expanded,
  onToggle,
  onOpen,
  onDelete,
  busy,
}: {
  summary: RunFileSummary;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const s = summary.summary;
  const isOk = s ? s.failed === 0 && s.errored === 0 : false;
  const typeLabel =
    summary.runType === "standalone" ? "Standalone" : "Group Run (Run All)";
  const TypeIcon = summary.runType === "standalone" ? Play : PlayCircle;
  return (
    <div className="border-b">
      <div className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30">
        <button
          type="button"
          className="flex-1 flex items-center gap-2 text-left min-w-0"
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          {s ? (
            isOk ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive shrink-0" />
            )
          ) : (
            <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {typeLabel}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {formatTime(summary.startedAt)}
              </span>
            </div>
            {s && (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {s.passed}/{s.total} passed
                {s.failed > 0 ? `, ${s.failed} failed` : ""}
                {s.errored > 0 ? `, ${s.errored} errored` : ""}
                {" · "}
                {formatDuration(s.durationMs)}
              </div>
            )}
          </div>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={busy}
          title="Delete this run"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pl-12 text-[10px] text-muted-foreground space-y-1">
          <div>id: {summary.id}</div>
          {summary.env?.proxyUrl && <div>proxy: {summary.env.proxyUrl}</div>}
          {summary.env?.platform && (
            <div>
              platform: {summary.env.platform}
              {summary.env.strict ? " · strict" : ""}
            </div>
          )}
          {summary.filter?.tags?.length ? (
            <div className="flex gap-1 flex-wrap items-center">
              <span>tags:</span>
              {summary.filter.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[9px] px-1">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpen}
            className="mt-2"
          >
            Open details
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

function RunDetail({
  file,
  onSelectEntry,
}: {
  file: RunFile;
  onSelectEntry: (entry: RunResultEntry) => void;
}) {
  const s = file.summary;
  return (
    <>
      <div className="px-4 py-3 border-b text-xs space-y-1">
        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={s.failed + s.errored === 0 ? "default" : "destructive"}
          >
            {s.passed}/{s.total} passed
          </Badge>
          {s.failed > 0 && (
            <Badge variant="destructive">{s.failed} failed</Badge>
          )}
          {s.errored > 0 && (
            <Badge variant="destructive">{s.errored} errored</Badge>
          )}
          <Badge variant="secondary">{formatDuration(s.durationMs)}</Badge>
        </div>
        <div className="text-muted-foreground">
          {formatTime(file.startedAt)} · {file.env.platform}
          {file.env.strict ? " · strict" : ""} · {file.env.proxyUrl}
        </div>
        {file.filter.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {file.filter.tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[9px] px-1">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {file.results.map((entry, i) => (
        <button
          key={`${entry.testFsName}_${i}`}
          type="button"
          onClick={() => onSelectEntry(entry)}
          className="w-full px-4 py-2.5 border-b flex items-center gap-2 text-left hover:bg-muted/30"
        >
          {entry.status === "passed" ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          ) : entry.status === "failed" ? (
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{entry.testName}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {entry.status === "errored" && entry.error
                ? entry.error
                : `${entry.verdict.drifts.length} drift${entry.verdict.drifts.length === 1 ? "" : "s"} · ${formatDuration(entry.durationMs)}`}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      ))}
    </>
  );
}
