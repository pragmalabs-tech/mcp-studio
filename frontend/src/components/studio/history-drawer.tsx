import { useState, useEffect } from "react";
import { History, Loader2, Trash2 } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  listReplaySummaries,
  deleteReplay,
  getReplay,
  type ReplaySummary,
} from "@/lib/studio/storage-api";
import { useTestStore } from "@/lib/studio/stores/test-store";
import { confirm } from "@/components/ui/confirm-dialog";
import { ReplayResultDialog } from "@/components/studio/replay-result-dialog";
import type { SavedReplay } from "@/lib/replays/storage";

interface RunGroup {
  runGroupId: string;
  profileName: string | null;
  startedAt: number;
  items: ReplaySummary[];
}

interface DateGroup {
  label: string;
  groups: RunGroup[];
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function groupSummaries(summaries: ReplaySummary[]): DateGroup[] {
  const sorted = [...summaries].sort((a, b) => b.modified_ms - a.modified_ms);

  const dateMap = new Map<string, Map<string, RunGroup>>();
  const dateOrder: string[] = [];

  for (const s of sorted) {
    const label = dayLabel(s.modified_ms);
    if (!dateMap.has(label)) {
      dateMap.set(label, new Map());
      dateOrder.push(label);
    }
    const groupMap = dateMap.get(label)!;

    // Summaries without run_group_id are treated as solo — use their id as key
    const groupKey = s.run_group_id ?? s.id;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        runGroupId: groupKey,
        profileName: s.profile_name,
        startedAt: s.modified_ms,
        items: [],
      });
    }
    const group = groupMap.get(groupKey)!;
    group.items.push(s);
    if (s.modified_ms < group.startedAt) {
      group.startedAt = s.modified_ms;
    }
  }

  return dateOrder.map((label) => ({
    label,
    groups: [...dateMap.get(label)!.values()],
  }));
}

interface RunGroupBlockProps {
  group: RunGroup;
  onViewReplay: (id: string) => void;
  onDeleted: (ids: string[]) => void;
}

function RunGroupBlock({ group, onViewReplay, onDeleted }: RunGroupBlockProps) {
  const passed = group.items.filter((s) => s.status === "passed").length;
  const failed = group.items.filter((s) => s.status === "failed").length;
  const total = group.items.length;
  const totalMs = group.items.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
  const time = new Date(group.startedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const groupStatus =
    failed > 0 ? "failed" : passed === total ? "passed" : "failed";

  const handleDeleteGroup = async () => {
    const ok = await confirm({
      title: `Delete ${total} run${total === 1 ? "" : "s"}?`,
      description:
        "Removes all replay results in this run. This can't be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    await Promise.all(group.items.map((s) => deleteReplay(s.id)));
    onDeleted(group.items.map((s) => s.id));
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden mb-2">
      <div className="px-2.5 py-2 flex items-center gap-2 bg-muted/30">
        <StatusBadge status={groupStatus} hideIcon className="shrink-0" />
        <span className="text-xs font-medium">{time}</span>
        {group.profileName && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground font-mono shrink-0">
            {group.profileName}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground flex-1">
          {total} test{total === 1 ? "" : "s"} ·{" "}
          <span className="text-green-500 dark:text-green-400">
            {passed} passed
          </span>
          {failed > 0 && (
            <>
              {" · "}
              <span className="text-destructive">{failed} failed</span>
            </>
          )}{" "}
          ·{" "}
          {totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 shrink-0 text-destructive hover:text-destructive"
          onClick={handleDeleteGroup}
          title="Delete all results in this run"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="divide-y">
        {group.items.map((s) => (
          <ResultRow
            key={s.id}
            summary={s}
            onView={() => onViewReplay(s.id)}
            onDeleted={() => onDeleted([s.id])}
          />
        ))}
      </div>
    </div>
  );
}

interface ResultRowProps {
  summary: ReplaySummary;
  onView: () => void;
  onDeleted: () => void;
}

function ResultRow({ summary, onView, onDeleted }: ResultRowProps) {
  const status =
    summary.status === "passed"
      ? "passed"
      : summary.status === "failed"
        ? "failed"
        : "skipped";

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete this replay?",
      description:
        "Removes the saved replay result. The recorded test stays intact.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    await deleteReplay(summary.id);
    onDeleted();
  };

  return (
    <div className="flex items-center gap-2 hover:bg-accent/40 transition-colors">
      <button
        onClick={onView}
        className="flex-1 min-w-0 px-2.5 py-1.5 text-left flex items-center gap-2"
      >
        <StatusBadge status={status} hideIcon className="shrink-0" />
        <span className="text-xs flex-1 truncate">
          {summary.test_name ?? summary.test_id ?? "Unknown test"}
        </span>
        {summary.duration_ms != null && (
          <span className="text-[11px] font-mono text-muted-foreground shrink-0">
            {summary.duration_ms}ms
          </span>
        )}
      </button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 mr-1 shrink-0 text-destructive hover:text-destructive"
        onClick={handleDelete}
        title="Delete replay"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

const PAGE_SIZE = 30;

interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HistoryDrawer({ open, onOpenChange }: HistoryDrawerProps) {
  const [summaries, setSummaries] = useState<ReplaySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replayResult, setReplayResult] = useState<SavedReplay | null>(null);
  const [replayDialogOpen, setReplayDialogOpen] = useState(false);
  const runState = useTestStore((s) => s.runState);

  const refresh = async () => {
    setLoading(true);
    try {
      const page = await listReplaySummaries({ limit: PAGE_SIZE });
      setSummaries(page);
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await listReplaySummaries({
        limit: PAGE_SIZE,
        offset: summaries.length,
      });
      setSummaries((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  };

  // Load on open and after each completed replay (runState flipping to null)
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, runState]);

  const dateGroups = groupSummaries(summaries);

  const handleViewReplay = async (id: string) => {
    const replay = await getReplay(id);
    if (!replay) return;
    setReplayResult(replay);
    setReplayDialogOpen(true);
  };

  const handleDeleted = (ids: string[]) => {
    const removed = new Set(ids);
    setSummaries((prev) => prev.filter((s) => !removed.has(s.id)));
  };

  const handleClearAll = async () => {
    // Fetch all summaries (no limit) so we delete beyond the current page.
    const all = await listReplaySummaries();
    const ok = await confirm({
      title: "Clear all history?",
      description: `Permanently deletes all ${all.length} replay result${all.length === 1 ? "" : "s"}. This can't be undone.`,
      confirmLabel: "Clear all",
      tone: "destructive",
    });
    if (!ok) return;
    await Promise.all(all.map((s) => deleteReplay(s.id)));
    setSummaries([]);
    setHasMore(false);
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent side="right">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              History
              {summaries.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7 px-2 text-destructive hover:text-destructive text-xs"
                  onClick={handleClearAll}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear all
                </Button>
              )}
            </DrawerTitle>
            <DrawerDescription>
              All replay runs, grouped by date and batch.
            </DrawerDescription>
          </DrawerHeader>

          <ScrollArea className="h-[calc(100vh-9rem)] mt-3 -mx-2 px-2">
            {loading ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : summaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
                <History className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm">No runs yet</p>
                <p className="text-xs mt-2">
                  Replay a test to see results here
                </p>
              </div>
            ) : (
              <div className="pb-4">
                {dateGroups.map((dateGroup) => (
                  <div key={dateGroup.label} className="mb-4">
                    <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {dateGroup.label}
                    </p>
                    {dateGroup.groups.map((group) => (
                      <RunGroupBlock
                        key={group.runGroupId}
                        group={group}
                        onViewReplay={handleViewReplay}
                        onDeleted={handleDeleted}
                      />
                    ))}
                  </div>
                ))}
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </Button>
                )}
              </div>
            )}
          </ScrollArea>
        </DrawerContent>
      </Drawer>
      <ReplayResultDialog
        open={replayDialogOpen}
        result={replayResult}
        onOpenChange={setReplayDialogOpen}
      />
    </>
  );
}
