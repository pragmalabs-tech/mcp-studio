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
import type { AssertResult, AssertReport, PointFailure } from "@/lib/assertion";
import type { ReplayedAction, SavedReplay } from "@/lib/replays/storage";

interface ReplayResultDialogProps {
  open: boolean;
  result: SavedReplay | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Overall step status drawn from its assert report. A step is "passed"
 * only if both the action and state assertions pass (skipped counts as
 * pass for back-compat with tests captured before the assertion layer).
 */
function stepStatus(assert: AssertReport): Status {
  if (assert.action.status === "failed" || assert.state.status === "failed") {
    return "failed";
  }
  return "passed";
}

function statusOf(assert: AssertResult): Status {
  if (assert.status === "failed") return "failed";
  if (assert.status === "skipped") return "skipped";
  return "passed";
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

  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [open, result?.id]);

  if (!result) return null;

  const passedCount = result.actions.filter(
    (a) => stepStatus(a.assert) === "passed",
  ).length;
  const total = result.actions.length;
  const selected = result.actions[selectedIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            {passedCount} / {total} steps passed · {result.durationMs}ms
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 min-w-0 gap-3 px-4 pb-4 border-t pt-3">
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
                  {result.actions.map((replayed, idx) => {
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
                        <StatusDot status={stepStatus(replayed.assert)} />
                        <span className="font-mono text-muted-foreground shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="flex-1 min-w-0 truncate font-medium">
                          {formatActionName(replayed.action)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="flex-1 min-w-0 min-h-0 border rounded-md overflow-hidden flex flex-col bg-card/40">
            {selected ? (
              <ReplayActionInspector
                replayed={selected}
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
  replayed: ReplayedAction;
  index: number;
}

function ReplayActionInspector({
  replayed,
  index,
}: ReplayActionInspectorProps) {
  const { action, relMs, stateChange, assert } = replayed;

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
        <StatusBadge status={stepStatus(assert)} />
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-4 text-xs">
          <Section label="Assertions">
            <div className="space-y-2">
              <ActionAssertionRow result={assert.action} />
              <AssertionRow label="State change" result={assert.state} />
            </div>
          </Section>

          <Section label="Type">
            <code className="font-mono">{action.type}</code>
          </Section>

          <Section label="Data">
            <JsonView value={action.data} />
          </Section>

          {action.result ? (
            <Section label="Result">
              {action.result.error ? (
                <pre className="font-mono text-xs bg-destructive/10 text-destructive p-2 rounded whitespace-pre-wrap break-words">
                  {action.result.error.message}
                </pre>
              ) : action.result.data === undefined ? (
                <div className="text-muted-foreground italic">
                  (no result data)
                </div>
              ) : (
                <JsonView value={action.result.data} />
              )}
            </Section>
          ) : null}

          {stateChange ? (
            <Section label="State change">
              <JsonView value={stateChange} />
            </Section>
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

/**
 * Action-result row. When verifyAction fails, `data.failures` carries
 * per-point detail — render one card per failing point with the diff
 * scoped to that point's value, instead of dumping the whole
 * expected/actual result tree.
 */
function ActionAssertionRow({ result }: { result: AssertResult }) {
  const failures = result.data.failures as PointFailure[] | undefined;

  if (result.status !== "failed" || !failures?.length) {
    return <AssertionRow label="Action result" result={result} />;
  }

  return (
    <div className="rounded border bg-background/40">
      <div className="px-2.5 py-1.5 flex items-center gap-2 border-b">
        <span className="font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
          Action result
        </span>
        <span className="flex-1" />
        <span className="text-[11px] text-muted-foreground">
          {failures.length} point{failures.length > 1 ? "s" : ""} failed
        </span>
        <StatusBadge status="failed" />
      </div>
      <div className="px-2.5 py-2 space-y-2">
        {failures.map((f, i) => (
          <PointFailureCard key={`${f.key}-${i}`} failure={f} />
        ))}
      </div>
    </div>
  );
}

function PointFailureCard({ failure }: { failure: PointFailure }) {
  return (
    <div className="rounded border border-destructive/30 bg-destructive/5 p-2 space-y-2">
      <div className="flex items-center gap-2">
        <code className="text-[11px] font-mono font-medium">{failure.key}</code>
        <span className="text-[9px] uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
          {failure.mode}
        </span>
        <span className="flex-1" />
        <span className="text-[11px] text-destructive truncate">
          {failure.reason}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Expected
          </div>
          <JsonView value={failure.expected} diffAgainst={failure.actual} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Actual
          </div>
          <JsonView value={failure.actual} diffAgainst={failure.expected} />
        </div>
      </div>
    </div>
  );
}

function AssertionRow({
  label,
  result,
}: {
  label: string;
  result: AssertResult;
}) {
  const failed = result.status === "failed";
  const hasData = result.data.expected !== undefined;
  // Diff colors only kick in when something actually differs. On pass we
  // still show the two columns so the user can confirm what was compared.
  const diff = failed;
  return (
    <div className="rounded border bg-background/40">
      <div className="px-2.5 py-1.5 flex items-center gap-2 border-b">
        <span className="font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="flex-1" />
        <StatusBadge status={statusOf(result)} />
      </div>
      <div className="px-2.5 py-2 space-y-2">
        {result.data.reason ? (
          <div className="text-[11px] text-muted-foreground">
            {result.data.reason}
          </div>
        ) : null}
        {hasData ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Expected
              </div>
              <JsonView
                value={result.data.expected}
                diffAgainst={diff ? result.data.actual : undefined}
              />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Actual
              </div>
              <JsonView
                value={result.data.actual}
                diffAgainst={diff ? result.data.expected : undefined}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
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
