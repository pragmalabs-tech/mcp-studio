import { useState, useEffect, useRef } from "react";
import {
  FlaskConical,
  Play,
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
import { TagFilter } from "@/components/ui/tag-filter";
import {
  loadTests,
  deleteTest,
  updateTestTags,
  type SavedTest,
} from "@/lib/tests/storage";
import { collectTags, normalizeTag } from "@/lib/tests/tags";
import { runReplay, countReplayableActions } from "@/lib/replays/runner";
import {
  loadReplaysForTest,
  deleteReplay,
  type SavedReplay,
} from "@/lib/replays/storage";
import { liveReplayStatus } from "@/lib/replays/live-status";
import { ReplayResultDialog } from "@/components/studio/replay-result-dialog";
import { JsonView } from "@/components/ui/json-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { confirm } from "@/components/ui/confirm-dialog";
import { useStudioStore } from "@/lib/studio/store";

interface TestsPageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TestsPage({ open, onOpenChange }: TestsPageProps) {
  const [tests, setTests] = useState<SavedTest[]>([]);
  const [replayResult, setReplayResult] = useState<SavedReplay | null>(null);
  const [replayDialogOpen, setReplayDialogOpen] = useState(false);
  const runState = useStudioStore((s) => s.runState);
  const setRunState = useStudioStore((s) => s.setRunState);
  const patchRunState = useStudioStore((s) => s.patchRunState);
  const setStudioMode = useStudioStore((s) => s.setStudioMode);

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

  const handleReplay = async (test: SavedTest) => {
    if (runState) return;

    const ok = await confirm({
      title: `Replay "${test.name}"?`,
      description:
        "Replay re-runs every recorded action against the live MCP server. Tool calls with side effects (writes, sends, deletes) will fire again.",
      confirmLabel: "Replay",
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
      mode: "auto",
      currentStep: -1,
      totalSteps,
      currentAction: null,
      ctrl,
      nextResolver: null,
    });

    try {
      const result = await runReplay(test, {
        signal: ctrl.signal,
        onProgress: ({ step, action, phase }) => {
          if (phase === "before") {
            patchRunState({ currentStep: step, currentAction: action });
          }
        },
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

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent side="right">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Tests
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
                    onOpenReplay={(replay) => {
                      setReplayResult(replay);
                      setReplayDialogOpen(true);
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
    </>
  );
}

interface TestCardProps {
  test: SavedTest;
  allTags: readonly string[];
  disableReplay: boolean;
  onRun: () => void;
  onDelete: () => void;
  onExport: () => void;
  onTagsChange: (tags: string[]) => void;
  onOpenReplay: (replay: SavedReplay) => void;
}

function TestCard({
  test,
  allTags,
  disableReplay,
  onRun,
  onDelete,
  onExport,
  onTagsChange,
  onOpenReplay,
}: TestCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<SavedReplay[]>([]);
  const actionCount = test.session.actions.length;
  const capturedAt = new Date(test.session.capturedAt).toLocaleString();

  // Load (or refresh) this test's replay history when the card is expanded.
  // Also re-runs after a replay completes — `runState` flipping back to null
  // is the global "a replay just finished" signal.
  const runState = useStudioStore((s) => s.runState);
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void (async () => {
      const all = await loadReplaysForTest(test.id);
      if (cancelled) return;
      setHistory(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, test.id, runState]);

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

          <Section title="Replay history" count={history.length}>
            {history.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-2 py-1">
                No replays yet — hit play above to capture one.
              </div>
            ) : (
              <div className="space-y-1">
                {history.map((replay) => (
                  <ReplayHistoryRow
                    key={replay.id}
                    test={test}
                    replay={replay}
                    onOpen={() => onOpenReplay(replay)}
                    onDelete={async () => {
                      const ok = await confirm({
                        title: "Delete this replay?",
                        description:
                          "Removes the saved replay result. The recorded test stays intact.",
                        confirmLabel: "Delete",
                        tone: "destructive",
                      });
                      if (!ok) return;
                      await deleteReplay(replay.id);
                      setHistory((h) => h.filter((r) => r.id !== replay.id));
                    }}
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

function ReplayHistoryRow({
  test,
  replay,
  onOpen,
  onDelete,
}: {
  test: SavedTest;
  replay: SavedReplay;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const when = new Date(replay.createdAt).toLocaleString();
  // Re-derive status against the test's current assertion modes. The
  // stored `replay.status` and per-step `assert` reports are frozen at
  // run time; if the user later marks a previously-failing point as
  // `flaky` / `ignore` in the dialog, this row should reflect that.
  const { status, passed, total } = liveReplayStatus(test, replay);
  return (
    <div className="rounded bg-background/60 overflow-hidden flex items-center gap-2 hover:bg-accent/40 transition-colors">
      <button
        onClick={onOpen}
        className="flex-1 min-w-0 px-2 py-1.5 text-left flex items-center gap-2"
      >
        <StatusBadge status={status} hideIcon className="shrink-0" />
        <span className="text-[11px] text-muted-foreground truncate flex-1">
          {when}
        </span>
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
          {passed}/{total} · {replay.durationMs}ms
        </span>
      </button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 mr-1 text-destructive hover:text-destructive"
        onClick={onDelete}
        title="Delete replay"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
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

  const name =
    action.type === "TOOL_CALL"
      ? `Tool · ${(action.data as any).tool}`
      : action.type === "RESOURCE_READ"
        ? `Resource · ${(action.data as any).uri}`
        : action.type === "WIDGET_CLICK"
          ? `Click · ${(action.data as any).fallbackText ?? (action.data as any).candidates?.[0] ?? "?"}`
          : action.type;

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
