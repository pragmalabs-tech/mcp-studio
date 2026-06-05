import { useState, useEffect, useRef } from "react";
import {
  FlaskConical,
  Play,
  PlaySquare,
  Footprints,
  Trash2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TagFilter } from "@/components/ui/tag-filter";
import {
  loadTests,
  deleteTest,
  updateTestTags,
  type SavedTest,
} from "@/lib/tests/storage";
import { collectTags, normalizeTag } from "@/lib/tests/tags";
import { runReplay, countReplayableActions } from "@/lib/replays/runner";
import { type SavedReplay } from "@/lib/replays/storage";
import { ReplayResultDialog } from "@/components/studio/replay-result-dialog";
import { JsonView } from "@/components/ui/json-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { confirm } from "@/components/ui/confirm-dialog";
import { useTestStore } from "@/lib/studio/stores/test-store";
import { useProfileStore } from "@/lib/studio/stores";
import { actionLabel } from "@/lib/core/action-format";

interface TestsPageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TestsPage({ open, onOpenChange }: TestsPageProps) {
  const [tests, setTests] = useState<SavedTest[]>([]);
  const [replayResult, setReplayResult] = useState<SavedReplay | null>(null);
  const [replayDialogOpen, setReplayDialogOpen] = useState(false);
  const [runAllResults, setRunAllResults] = useState<
    Array<{ test: SavedTest; replay: SavedReplay }>
  >([]);
  const [runAllDialogOpen, setRunAllDialogOpen] = useState(false);
  const runState = useTestStore((s) => s.runState);
  const setRunState = useTestStore((s) => s.setRunState);
  const patchRunState = useTestStore((s) => s.patchRunState);
  const setStudioMode = useTestStore((s) => s.setStudioMode);
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const activeProfileName = profiles.find(
    (p) => p.id === activeProfileId,
  )?.name;

  const { tags: rawTagParam } = useSearch({ from: "/" });
  const navigate = useNavigate({ from: "/" });
  const selectedTags = rawTagParam
    ? rawTagParam.split(",").filter(Boolean)
    : [];

  function setSelectedTags(next: string[]) {
    void navigate({
      search: (prev) => {
        const updated = { ...prev, tags: next.join(",") || undefined };
        return updated;
      },
    });
  }

  const allTags = collectTags(tests);
  const visibleTests =
    selectedTags.length === 0
      ? tests
      : tests.filter((t) => {
          const testTags = new Set(t.tags ?? []);
          return selectedTags.every((tag) => testTags.has(tag));
        });

  // Load tests when drawer opens — newest first so the most recently
  // recorded session is at the top.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const all = await loadTests();
      if (cancelled) return;
      setTests(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleReplay = async (
    test: SavedTest,
    mode: "auto" | "step" = "auto",
  ) => {
    if (runState) return;

    const ok = await confirm({
      title:
        mode === "step"
          ? `Step through "${test.name}"?`
          : `Replay "${test.name}"?`,
      description:
        mode === "step"
          ? "Step mode pauses before each recorded action so you can advance one at a time and watch the studio react. Tool calls with side effects (writes, sends, deletes) still fire when you advance past them."
          : "Replay re-runs every recorded action against the live MCP server. Tool calls with side effects (writes, sends, deletes) will fire again.",
      confirmLabel: mode === "step" ? "Step" : "Replay",
    });
    if (!ok) return;

    const totalSteps = countReplayableActions(test);
    const ctrl = new AbortController();

    // Hide the drawer for the duration of the run so the studio is visible
    // behind the blocking overlay + RunBar in the header.
    onOpenChange(false);

    setStudioMode("test");
    setRunState({
      testName: test.name,
      mode,
      currentStep: -1,
      totalSteps,
      currentAction: null,
      ctrl,
      nextResolver: null,
    });

    // Step gate: in step mode, park a resolver on the run state that the
    // RunBar's Next button calls; in auto mode (or after "Auto" is pressed
    // mid-run) it resolves immediately. Reads the *current* mode each step
    // so switching to Auto takes effect from the next step on.
    const gate = () => {
      const rs = useTestStore.getState().runState;
      if (!rs || rs.mode !== "step") return;
      return new Promise<void>((resolve) => {
        patchRunState({ nextResolver: resolve });
      });
    };

    try {
      const result = await runReplay(test, {
        signal: ctrl.signal,
        onProgress: ({ step, action, phase }) => {
          if (phase === "before") {
            patchRunState({ currentStep: step, currentAction: action });
          }
        },
        gate,
        runGroupId: crypto.randomUUID(),
        profileName: activeProfileName,
      });
      setReplayResult(result);
      setReplayDialogOpen(true);
    } catch (err) {
      console.error("Replay failed:", err);
    } finally {
      setRunState(null);
      setStudioMode("normal");
    }
  };

  const handleExport = (test: SavedTest) => {
    const json = JSON.stringify(test, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${test.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRunAll = async () => {
    if (runState || visibleTests.length === 0) return;

    const count = visibleTests.length;
    const ok = await confirm({
      title: `Run ${count} test${count === 1 ? "" : "s"}?`,
      description:
        "Runs each visible test in sequence against the live MCP server. Tool calls with side effects will fire again.",
      confirmLabel: "Run All",
    });
    if (!ok) return;

    onOpenChange(false);
    setStudioMode("test");

    const ctrl = new AbortController();
    const batchGroupId = crypto.randomUUID();
    const results: Array<{ test: SavedTest; replay: SavedReplay }> = [];

    for (let i = 0; i < visibleTests.length; i++) {
      if (ctrl.signal.aborted) break;
      const test = visibleTests[i];
      const totalSteps = countReplayableActions(test);

      setRunState({
        testName: `[${i + 1}/${count}] ${test.name}`,
        mode: "auto",
        currentStep: -1,
        totalSteps,
        currentAction: null,
        ctrl,
        nextResolver: null,
      });

      try {
        const replay = await runReplay(test, {
          signal: ctrl.signal,
          onProgress: ({ step, action, phase }) => {
            if (phase === "before") {
              patchRunState({ currentStep: step, currentAction: action });
            }
          },
          runGroupId: batchGroupId,
          profileName: activeProfileName,
        });
        results.push({ test, replay });
      } catch (err) {
        console.error(`Replay failed for "${test.name}":`, err);
      }
    }

    setRunState(null);
    setStudioMode("normal");
    setRunAllResults(results);
    setRunAllDialogOpen(true);
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent side="right">
          <DrawerHeader>
            <DrawerTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Tests
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs gap-1.5"
                onClick={handleRunAll}
                disabled={runState !== null || visibleTests.length === 0}
                title={`Run ${visibleTests.length} visible test(s)`}
              >
                <PlaySquare className="h-3.5 w-3.5" />
                Run All
                {visibleTests.length > 0 && (
                  <span className="text-muted-foreground font-normal">
                    ({visibleTests.length})
                  </span>
                )}
              </Button>
            </DrawerTitle>
            <DrawerDescription>
              Recorded test sessions. Use the play button to replay against the
              live MCP server.
            </DrawerDescription>
          </DrawerHeader>

          {allTags.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Filter by tag
              </p>
              <TagFilter
                tags={allTags}
                selected={selectedTags}
                onSelectionChange={setSelectedTags}
              />
            </div>
          )}

          <ScrollArea className="h-[calc(100vh-9rem)] mt-3 -mx-2 px-2">
            {tests.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
                <FlaskConical className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm">No tests recorded yet</p>
                <p className="text-xs mt-2">
                  Click Record Test in the toolbar to create your first test
                </p>
              </div>
            ) : visibleTests.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
                <p className="text-sm">No tests match the current filter</p>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {visibleTests.map((test) => (
                  <TestCard
                    key={test.id}
                    test={test}
                    allTags={allTags}
                    disableReplay={runState !== null}
                    onRun={() => handleReplay(test)}
                    onStep={() => handleReplay(test, "step")}
                    onDelete={async () => {
                      const ok = await confirm({
                        title: `Delete "${test.name}"?`,
                        description:
                          "This removes the recorded session and any saved replay results stay orphaned. This can't be undone.",
                        confirmLabel: "Delete",
                        tone: "destructive",
                      });
                      if (!ok) return;
                      await deleteTest(test.id);
                      setTests(tests.filter((t) => t.id !== test.id));
                    }}
                    onExport={() => handleExport(test)}
                    onTagsChange={(updated) => {
                      setTests((prev) =>
                        prev.map((t) =>
                          t.id === test.id ? { ...t, tags: updated } : t,
                        ),
                      );
                    }}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </DrawerContent>
      </Drawer>

      {/* Rendered outside the drawer so it stays mounted across drawer toggles
          and the post-run open works even if the drawer was auto-closed. */}
      <ReplayResultDialog
        open={replayDialogOpen}
        result={replayResult}
        onOpenChange={setReplayDialogOpen}
      />
      <RunAllResultsDialog
        open={runAllDialogOpen}
        results={runAllResults}
        onOpenChange={setRunAllDialogOpen}
        onViewReplay={(replay) => {
          setReplayResult(replay);
          setReplayDialogOpen(true);
        }}
      />
    </>
  );
}

interface TestCardProps {
  test: SavedTest;
  allTags: readonly string[];
  disableReplay: boolean;
  onRun: () => void;
  onStep: () => void;
  onDelete: () => void;
  onExport: () => void;
  onTagsChange: (tags: string[]) => void;
}

function TestCard({
  test,
  allTags,
  disableReplay,
  onRun,
  onStep,
  onDelete,
  onExport,
  onTagsChange,
}: TestCardProps) {
  const [expanded, setExpanded] = useState(false);
  const actionCount = test.session.actions.length;
  const capturedAt = new Date(test.session.capturedAt).toLocaleString();

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="px-3 py-2.5 hover:bg-accent/40 transition-colors">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-1 min-w-0 flex items-center gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm truncate">{test.name}</h3>
              <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                <span>
                  {actionCount} action{actionCount === 1 ? "" : "s"}
                </span>
                <span>·</span>
                <span className="truncate">{capturedAt}</span>
              </div>
              {(test.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(test.tags ?? []).map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 font-normal"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={onRun}
              disabled={disableReplay}
              title={disableReplay ? "Replay in progress…" : "Replay test"}
            >
              {disableReplay ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={onStep}
              disabled={disableReplay}
              title={
                disableReplay
                  ? "Replay in progress…"
                  : "Step through test (pause before each action)"
              }
            >
              <Footprints className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={onExport}
              title="Export test as JSON"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              onClick={onDelete}
              title="Delete test"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/20 p-2 space-y-3">
          <Section title="Tags">
            <div className="px-2 pb-1">
              <InlineTagEditor
                tags={test.tags ?? []}
                onChange={async (next) => {
                  onTagsChange(next);
                  await updateTestTags(test.id, next);
                }}
              />
            </div>
          </Section>

          <Section title="Actions">
            {test.session.actions.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-2 py-1">
                No actions recorded
              </div>
            ) : (
              <div className="space-y-1">
                {test.session.actions.map((recordedAction, idx) => (
                  <ActionDetail
                    key={idx}
                    recordedAction={recordedAction}
                    index={idx}
                  />
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function InlineTagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [buffer, setBuffer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(raw: string) {
    const tag = normalizeTag(raw);
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setBuffer("");
  }

  function startAdding() {
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 min-h-6">
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="text-[10px] px-1.5 py-0 gap-0.5 font-normal"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="ml-0.5 -mr-0.5 hover:text-foreground text-muted-foreground"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(buffer);
            } else if (e.key === "Escape") {
              setAdding(false);
              setBuffer("");
            }
          }}
          onBlur={() => {
            if (buffer.trim()) commit(buffer);
            setAdding(false);
            setBuffer("");
          }}
          placeholder="tag name…"
          className="text-[11px] h-5 w-24 px-1.5 rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring/50 dark:bg-input/30"
        />
      ) : (
        <button
          type="button"
          onClick={startAdding}
          className="text-[11px] flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add tag
        </button>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-2 pb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-muted-foreground/70">· {count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

interface ActionDetailProps {
  recordedAction: SavedTest["session"]["actions"][0];
  index: number;
}

function ActionDetail({ recordedAction, index }: ActionDetailProps) {
  const { action, relMs } = recordedAction;
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const name = actionLabel(action);

  const time = `+${(relMs / 1000).toFixed(2)}s`;

  return (
    <div className="rounded bg-background/60 overflow-hidden">
      <button
        onClick={() => setDetailsExpanded(!detailsExpanded)}
        className="w-full px-2 py-1.5 text-left hover:bg-accent/40 transition-colors flex items-center gap-2"
      >
        {detailsExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
          #{index + 1}
        </span>
        <span className="text-xs font-medium flex-1 truncate">{name}</span>
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
          {time}
        </span>
      </button>

      {detailsExpanded && (
        <div className="border-t px-2 py-2 text-xs">
          <JsonView value={action.data} className="bg-muted/60" />
        </div>
      )}
    </div>
  );
}

interface RunAllResultsDialogProps {
  open: boolean;
  results: Array<{ test: SavedTest; replay: SavedReplay }>;
  onOpenChange: (open: boolean) => void;
  onViewReplay: (replay: SavedReplay) => void;
}

function RunAllResultsDialog({
  open,
  results,
  onOpenChange,
  onViewReplay,
}: RunAllResultsDialogProps) {
  const passed = results.filter((r) => r.replay.status === "passed").length;
  const failed = results.length - passed;
  const totalMs = results.reduce((sum, r) => sum + r.replay.durationMs, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlaySquare className="h-5 w-5" />
            Run All Results
          </DialogTitle>
          <DialogDescription>
            {results.length} test{results.length === 1 ? "" : "s"} ·{" "}
            <span className="text-green-500">{passed} passed</span>
            {failed > 0 && (
              <>
                {" · "}
                <span className="text-destructive">{failed} failed</span>
              </>
            )}{" "}
            ·{" "}
            {totalMs < 1000
              ? `${totalMs}ms`
              : `${(totalMs / 1000).toFixed(1)}s`}{" "}
            total
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-96 -mx-1 px-1">
          <div className="space-y-1 py-1">
            {results.map(({ test, replay }) => (
              <div
                key={replay.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40 transition-colors"
              >
                <StatusBadge
                  status={replay.status}
                  hideIcon
                  className="shrink-0"
                />
                <span className="flex-1 min-w-0 text-sm truncate">
                  {test.name}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {replay.durationMs}ms
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs shrink-0"
                  onClick={() => {
                    onViewReplay(replay);
                    onOpenChange(false);
                  }}
                >
                  View
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
