import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge, StatusDot } from "@/components/ui/status-badge";
import { JsonView } from "@/components/ui/json-view";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/status";
import type { SavedReplay } from "@/lib/replays/storage";

function actionStatus(action: { result?: { success: boolean } }): Status {
  if (!action.result) return "skipped";
  return action.result.success ? "passed" : "failed";
}

interface ReplayResultDialogProps {
  open: boolean;
  result: SavedReplay | null;
  onOpenChange: (open: boolean) => void;
}

function formatActionName(action: { type: string; data: any }): string {
  if (action.type === "TOOL_CALL") return `Tool · ${action.data?.tool ?? "?"}`;
  if (action.type === "RESOURCE_READ")
    return `Resource · ${action.data?.uri ?? "?"}`;
  return action.type;
}

export function ReplayResultDialog({
  open,
  result,
  onOpenChange,
}: ReplayResultDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection whenever a new replay is shown.
  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [open, result?.id]);

  if (!result) return null;

  const passedCount = result.actions.filter(
    (a) => a.action.result?.success === true,
  ).length;
  const total = result.actions.length;
  const selected = result.actions[selectedIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Override the default `grid` + `sm:max-w-sm` so the dialog fills
          ~80% of the viewport and the inner panes can shrink properly. */}
      <DialogContent
        className={cn(
          "flex flex-col gap-3",
          "w-[90vw] sm:max-w-[1400px] h-[85vh] max-h-[85vh] p-0",
        )}
      >
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="truncate">Replay · {result.testName}</span>
            <StatusBadge status={result.status} />
          </DialogTitle>
          <DialogDescription>
            {passedCount} / {total} actions passed · {result.durationMs}ms
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 min-w-0 gap-3 px-4 pb-4 border-t pt-3">
          {/* Left: action list */}
          <div className="w-64 shrink-0 border rounded-md overflow-hidden flex flex-col bg-card/40">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
              Actions
            </div>
            <ScrollArea className="flex-1 min-h-0">
              {total === 0 ? (
                <div className="p-4 text-xs text-muted-foreground italic">
                  No actions executed
                </div>
              ) : (
                <div className="p-1">
                  {result.actions.map((recorded, idx) => {
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedIndex(idx)}
                        className={cn(
                          "w-full px-2.5 py-2 rounded-md text-left flex items-center gap-2 text-xs transition-colors",
                          isSelected
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50",
                        )}
                      >
                        <StatusDot status={actionStatus(recorded.action)} />
                        <span className="font-mono text-muted-foreground shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="flex-1 min-w-0 truncate font-medium">
                          {formatActionName(recorded.action)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right: inspector */}
          <div className="flex-1 min-w-0 min-h-0 border rounded-md overflow-hidden flex flex-col bg-card/40">
            {selected ? (
              <ReplayActionInspector
                recorded={selected}
                index={selectedIndex}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                Select an action to inspect
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ReplayActionInspectorProps {
  recorded: SavedReplay["actions"][number];
  index: number;
}

function ReplayActionInspector({
  recorded,
  index,
}: ReplayActionInspectorProps) {
  const { action, relMs } = recorded;
  const result = action.result;
  const success = result?.success === true;

  return (
    <>
      <div className="px-3 py-2 border-b bg-muted/30 flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Step #{index + 1}
        </span>
        <span className="text-xs font-medium truncate">
          {formatActionName(action)}
        </span>
        <span className="flex-1" />
        <StatusBadge status={actionStatus(action)} />
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-4 text-xs">
          <Section label="Type">
            <code className="font-mono">{action.type}</code>
          </Section>

          <Section label="Data">
            <JsonView value={action.data} />
          </Section>

          {result ? (
            success ? (
              <Section label="Result">
                {result.data === undefined ? (
                  <div className="text-muted-foreground italic">
                    (no result data)
                  </div>
                ) : (
                  <JsonView value={result.data} />
                )}
              </Section>
            ) : (
              <Section label="Error">
                <pre className="font-mono text-xs bg-destructive/10 text-destructive p-2 rounded whitespace-pre-wrap break-words">
                  {result.error?.message ?? "Unknown error"}
                </pre>
              </Section>
            )
          ) : null}

          <Section label="Timing">
            <span className="font-mono">
              +{(relMs / 1000).toFixed(2)}s from run start
            </span>
          </Section>

          <Section label="Action ID">
            <span className="font-mono text-[10px] break-all">{action.id}</span>
          </Section>
        </div>
      </ScrollArea>
    </>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
