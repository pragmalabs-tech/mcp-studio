import { useState, useEffect } from "react";
import {
  FlaskConical,
  Play,
  Trash2,
  ChevronDown,
  ChevronRight,
  Download,
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

interface TestsPageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TestsPage({ open, onOpenChange }: TestsPageProps) {
  const [tests, setTests] = useState<SavedTest[]>([]);

  // Load tests when drawer opens
  useEffect(() => {
    if (open) {
      setTests(loadTests());
    }
  }, [open]);

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
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Tests
          </DrawerTitle>
          <DrawerDescription>
            Recorded test sessions. Record new tests using the Record button in
            the top toolbar.
          </DrawerDescription>
        </DrawerHeader>

        <ScrollArea className="h-[calc(100vh-8rem)] mt-6">
          {tests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
              <FlaskConical className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-sm">No tests recorded yet</p>
              <p className="text-xs mt-2">
                Click Record Test in the toolbar to create your first test
              </p>
            </div>
          ) : (
            <div className="space-y-2 pr-4">
              {tests.map((test) => (
                <TestCard
                  key={test.id}
                  test={test}
                  onRun={() => {
                    // TODO: Implement test runner
                    console.log("Run test:", test.id);
                  }}
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
  );
}

interface TestCardProps {
  test: SavedTest;
  onRun: () => void;
  onDelete: () => void;
  onExport: () => void;
}

function TestCard({ test, onRun, onDelete, onExport }: TestCardProps) {
  const [expanded, setExpanded] = useState(false);
  const actionCount = test.session.actions.length;
  const capturedAt = new Date(test.session.capturedAt).toLocaleString();

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="p-4 hover:bg-accent/50 transition-colors">
        <div className="flex items-start justify-between gap-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-1 min-w-0 flex items-start gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm truncate">{test.name}</h3>
              <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                <span>{actionCount} actions</span>
                <span>{capturedAt}</span>
              </div>
              {test.session.setup.url && (
                <div className="mt-2 text-xs text-muted-foreground truncate">
                  {test.session.setup.url}
                </div>
              )}
            </div>
          </button>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={onExport}
              title="Export test as JSON"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={onRun}
              title="Run test"
            >
              <Play className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              onClick={onDelete}
              title="Delete test"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/30 p-4">
          <div className="space-y-3">
            {test.session.actions.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">
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

  const formatActionName = () => {
    if (action.type === "TOOL_CALL") {
      return `Tool: ${(action.data as any).tool}`;
    }
    if (action.type === "RESOURCE_READ") {
      return `Resource: ${(action.data as any).uri}`;
    }
    return action.type;
  };

  const formatTime = () => {
    const seconds = (relMs / 1000).toFixed(2);
    return `+${seconds}s`;
  };

  return (
    <div className="border rounded bg-background/50 overflow-hidden">
      <button
        onClick={() => setDetailsExpanded(!detailsExpanded)}
        className="w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {detailsExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span className="text-xs font-mono text-muted-foreground">
            #{index + 1}
          </span>
          <span className="text-xs font-medium flex-1 truncate">
            {formatActionName()}
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {formatTime()}
          </span>
        </div>
      </button>

      {detailsExpanded && (
        <div className="border-t px-3 py-2 text-xs">
          <div className="space-y-2">
            <div>
              <div className="font-medium text-muted-foreground mb-1">Type</div>
              <div className="font-mono">{action.type}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground mb-1">Data</div>
              <pre className="font-mono text-xs bg-muted p-2 rounded overflow-x-auto">
                {JSON.stringify(action.data, null, 2)}
              </pre>
            </div>
            <div>
              <div className="font-medium text-muted-foreground mb-1">
                Action ID
              </div>
              <div className="font-mono text-[10px] break-all">{action.id}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground mb-1">
                Timestamp
              </div>
              <div className="font-mono">
                {new Date(action.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
