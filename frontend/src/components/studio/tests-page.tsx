import { useState, useEffect } from "react";
import {
  FlaskConical,
  Play,
  Trash2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { loadTests, deleteTest, type SavedTest } from "@/lib/tests/storage";
import { runReplay, countReplayableActions } from "@/lib/replays/runner";
import type { SavedReplay } from "@/lib/replays/storage";
import { ReplayResultDialog } from "@/components/studio/replay-result-dialog";
import { JsonView } from "@/components/ui/json-view";
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

  // Load tests when drawer opens
  useEffect(() => {
    if (open) {
      setTests(loadTests());
    }
  }, [open]);

  const handleReplay = async (test: SavedTest) => {
    if (runState) return;

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

          <ScrollArea className="h-[calc(100vh-9rem)] mt-4 -mx-2 px-2">
            {tests.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
                <FlaskConical className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-sm">No tests recorded yet</p>
                <p className="text-xs mt-2">
                  Click Record Test in the toolbar to create your first test
                </p>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {tests.map((test) => (
                  <TestCard
                    key={test.id}
                    test={test}
                    disableReplay={runState !== null}
                    onRun={() => handleReplay(test)}
                    onDelete={() => {
                      deleteTest(test.id);
                      setTests(tests.filter((t) => t.id !== test.id));
                    }}
                    onExport={() => handleExport(test)}
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
  disableReplay: boolean;
  onRun: () => void;
  onDelete: () => void;
  onExport: () => void;
}

function TestCard({
  test,
  disableReplay,
  onRun,
  onDelete,
  onExport,
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
        <div className="border-t bg-muted/20 p-2 space-y-1">
          {test.session.actions.length === 0 ? (
            <div className="text-xs text-muted-foreground italic px-2 py-1">
              No actions recorded
            </div>
          ) : (
            test.session.actions.map((recordedAction, idx) => (
              <ActionDetail
                key={idx}
                recordedAction={recordedAction}
                index={idx}
              />
            ))
          )}
        </div>
      )}
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
