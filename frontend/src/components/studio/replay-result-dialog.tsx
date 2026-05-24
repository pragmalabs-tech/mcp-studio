import { useEffect, useMemo, useState } from "react";
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
import {
  resolveResultModes,
  resolveStateMode,
  verifyAction,
  compareByMode,
  getByPath,
  type AssertResult,
  type AssertReport,
  type Mode,
  type TestAssertionConfig,
} from "@/lib/assertion";
import { assertablePointsForType } from "@/lib/action";
import {
  getTest,
  updateTestAssertions,
  type SavedTest,
} from "@/lib/tests/storage";
import type { ReplayedAction, SavedReplay } from "@/lib/replays/storage";
import {
  liveAssertFor,
  stepStatus,
  findRecordedBaseline,
} from "@/lib/replays/live-status";
import type { RecordedAction } from "@/lib/recorder/schema";
import { AssertionPointRow } from "./assertion-point-row";

interface ReplayResultDialogProps {
  open: boolean;
  result: SavedReplay | null;
  onOpenChange: (open: boolean) => void;
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
  // The dialog owns its own copy of the test so mode changes re-render
  // immediately. Writes go through `updateTestAssertions` to persist.
  const [test, setTest] = useState<SavedTest | null>(null);

  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [open, result?.id]);

  useEffect(() => {
    if (!result) {
      setTest(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const t = await getTest(result.testId);
      if (!cancelled) setTest(t);
    })();
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (!result) return null;

  // Live re-verify every step against the user's current `test.assertions`
  // so the sidebar dots, "X / Y steps passed" header, and step status
  // badges all reflect the latest config — not the modes frozen at the
  // time the replay was captured.
  const liveAsserts = result.actions.map((a, i) => liveAssertFor(test, a, i));
  const liveOverallStatus: Status = liveAsserts.some(
    (a) => stepStatus(a) === "failed",
  )
    ? "failed"
    : "passed";
  const passedCount = liveAsserts.filter(
    (a) => stepStatus(a) === "passed",
  ).length;
  const total = result.actions.length;
  const selected = result.actions[selectedIndex];
  const selectedLiveAssert = liveAsserts[selectedIndex];

  const handleAssertionsChange = (cfg: TestAssertionConfig) => {
    if (!test) return;
    // Optimistic UI: flip the local copy immediately so dialog rows
    // re-render under the new modes; persist in the background and log
    // on failure (no rollback — the dialog stays usable either way).
    setTest({ ...test, assertions: cfg });
    void updateTestAssertions(test.id, cfg).catch((e) => {
      console.warn("updateTestAssertions failed:", e);
    });
  };

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
            <StatusBadge status={liveOverallStatus} />
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
                        <StatusDot status={stepStatus(liveAsserts[idx])} />
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
                test={test}
                liveAssert={selectedLiveAssert}
                onAssertionsChange={handleAssertionsChange}
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
  test: SavedTest | null;
  liveAssert: AssertReport;
  onAssertionsChange: (cfg: TestAssertionConfig) => void;
}

function ReplayActionInspector({
  replayed,
  index,
  test,
  liveAssert,
  onAssertionsChange,
}: ReplayActionInspectorProps) {
  const { action, relMs, stateChange } = replayed;

  // Find the recorded baseline. Prefer the explicit `recordedActionId` if
  // present (replays saved after that field was added); fall back to
  // positional lookup for legacy replays.
  const recorded = useMemo(
    () => findRecordedBaseline(test, replayed, index),
    [test, replayed, index],
  );
  const recordedActionId = replayed.recordedActionId ?? recorded?.action.id;

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
        <StatusBadge status={stepStatus(liveAssert)} />
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-4 text-xs">
          <Section label="Assertions">
            <div className="space-y-2">
              <ActionAssertions
                test={test}
                recordedActionId={recordedActionId}
                recordedResult={recorded?.action.result}
                liveResult={action.result}
                fallbackAssert={liveAssert.action}
                onAssertionsChange={onAssertionsChange}
              />
              <StateAssertions
                test={test}
                recordedActionId={recordedActionId}
                recordedState={recorded?.stateChange}
                liveState={stateChange}
                fallbackAssert={liveAssert.state}
                onAssertionsChange={onAssertionsChange}
              />
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

          {(() => {
            const liveSnap = (action.result?.data as { snapshot?: unknown })
              ?.snapshot;
            const recordedSnap = (
              recorded?.action.result?.data as { snapshot?: unknown }
            )?.snapshot;
            const hasAny =
              typeof liveSnap === "string" || typeof recordedSnap === "string";
            if (!hasAny) return null;
            return (
              <Section label="Snapshot">
                <div className="grid grid-cols-2 gap-2 min-w-0">
                  <SnapshotPane label="Recorded" snapshot={recordedSnap} />
                  <SnapshotPane label="Replay" snapshot={liveSnap} />
                </div>
              </Section>
            );
          })()}

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

interface ActionAssertionsProps {
  test: SavedTest | null;
  recordedActionId: string | undefined;
  recordedResult:
    | { success: boolean; data?: unknown; error?: { message: string } }
    | undefined;
  liveResult:
    | { success: boolean; data?: unknown; error?: { message: string } }
    | undefined;
  fallbackAssert: AssertResult;
  onAssertionsChange: (cfg: TestAssertionConfig) => void;
}

/**
 * Renders one row per declared assertable point. Re-verifies the recorded
 * baseline against the live result on every render using the current
 * modes from `test.assertions`, so mode changes preview instantly without
 * re-running the replay against the live MCP server.
 */
function ActionAssertions({
  test,
  recordedActionId,
  recordedResult,
  liveResult,
  fallbackAssert,
  onAssertionsChange,
}: ActionAssertionsProps) {
  // No test loaded (or recorded baseline missing) — render the stored
  // assert report read-only.
  if (!test || !recordedActionId) {
    return <ReadonlyActionAssertion result={fallbackAssert} />;
  }

  const actionType = pickActionType(test, recordedActionId);
  const points = actionType ? assertablePointsForType(actionType) : [];
  if (points.length === 0) {
    return <ReadonlyActionAssertion result={fallbackAssert} />;
  }

  const modes = resolveResultModes(test.assertions, recordedActionId, points);
  const live = verifyAction(points, recordedResult, liveResult, modes);
  const failureByKey = new Map(
    (live.data.failures ?? []).map((f) => [f.key, f]),
  );

  const aggregateStatus: Status =
    live.status === "failed"
      ? "failed"
      : live.status === "skipped"
        ? "skipped"
        : "passed";

  const onModeChange = (pointKey: string, mode: Mode) => {
    const cfg = test.assertions ?? {};
    const per = cfg.perAction ?? {};
    const entry = per[recordedActionId] ?? {};
    const result = entry.result ?? {};
    const next: TestAssertionConfig = {
      ...cfg,
      perAction: {
        ...per,
        [recordedActionId]: {
          ...entry,
          result: { ...result, [pointKey]: mode },
        },
      },
    };
    onAssertionsChange(next);
  };

  const failedCount = (live.data.failures ?? []).length;

  return (
    <div className="rounded border bg-background/40">
      <div className="px-2.5 py-1.5 flex items-center gap-2 border-b">
        <span className="font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
          Action result
        </span>
        <span className="flex-1" />
        {failedCount > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {failedCount} of {points.length} failed
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {points.length} point{points.length > 1 ? "s" : ""} checked
          </span>
        )}
        <StatusBadge status={aggregateStatus} />
      </div>
      <div className="px-2.5 py-2 space-y-2">
        {points.map((p) => (
          <AssertionPointRow
            key={p.key}
            point={p}
            mode={modes[p.key]}
            expected={getByPath(recordedResult, p.path)}
            actual={getByPath(liveResult, p.path)}
            failure={failureByKey.get(p.key)}
            skipped={recordedResult === undefined}
            onModeChange={(m) => onModeChange(p.key, m)}
          />
        ))}
      </div>
    </div>
  );
}

function pickActionType(
  test: SavedTest,
  recordedActionId: string,
): string | undefined {
  return test.session.actions.find((a) => a.action.id === recordedActionId)
    ?.action.type;
}

function ReadonlyActionAssertion({ result }: { result: AssertResult }) {
  return <AssertionRow label="Action result" result={result} />;
}

interface StateAssertionsProps {
  test: SavedTest | null;
  recordedActionId: string | undefined;
  recordedState: ReplayedAction["stateChange"];
  liveState: ReplayedAction["stateChange"];
  fallbackAssert: AssertResult;
  onAssertionsChange: (cfg: TestAssertionConfig) => void;
}

/**
 * State change has only one mode (whole-object compare). Renders the row
 * with a mode dropdown that writes through to `perAction[id].state`.
 */
function StateAssertions({
  test,
  recordedActionId,
  recordedState,
  liveState,
  fallbackAssert,
  onAssertionsChange,
}: StateAssertionsProps) {
  if (!test || !recordedActionId) {
    return <AssertionRow label="State change" result={fallbackAssert} />;
  }

  const stateMode = resolveStateMode(test.assertions, recordedActionId);
  const stateSupportedModes: Mode[] = ["exact", "shape", "flaky", "ignore"];

  const onModeChange = (m: Mode) => {
    const cfg = test.assertions ?? {};
    const per = cfg.perAction ?? {};
    const entry = per[recordedActionId] ?? {};
    const next: TestAssertionConfig = {
      ...cfg,
      perAction: { ...per, [recordedActionId]: { ...entry, state: m } },
    };
    onAssertionsChange(next);
  };

  // Use the fallback assert for status until we wire in live state re-verify
  // (it'd require running the action again to get a fresh `change()`, which
  // the dialog can't do). Show the dropdown either way so users can prep
  // the mode for the next run.
  return (
    <div className="rounded border bg-background/40">
      <div className="px-2.5 py-1.5 flex items-center gap-2 border-b">
        <span className="font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
          State change
        </span>
        <span className="flex-1" />
        <StatusBadge status={statusOf(fallbackAssert)} />
      </div>
      <div className="px-2.5 py-2 space-y-2">
        <AssertionPointRow
          point={{
            key: "state",
            label: "State change",
            path: "",
            defaultMode: "exact",
            supportedModes: stateSupportedModes,
          }}
          mode={stateMode}
          expected={recordedState}
          actual={liveState}
          failure={
            fallbackAssert.status === "failed"
              ? {
                  key: "state",
                  mode: stateMode,
                  expected: recordedState,
                  actual: liveState,
                  reason: fallbackAssert.data.reason ?? "mismatch",
                }
              : undefined
          }
          onModeChange={onModeChange}
        />
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

/**
 * One side of the side-by-side Snapshot section. Renders the captured
 * HTML inside an empty-sandbox iframe (no scripts, no same-origin) so
 * it stays purely visual. The CSS prepended to `srcDoc` hides the
 * iframe's own scrollbar — content taller than the pane still scrolls
 * via mouse wheel, just without the visual noise the native scrollbar
 * adds in a small viewer.
 */
function SnapshotPane({
  label,
  snapshot,
}: {
  label: string;
  snapshot: unknown;
}) {
  const hasSnapshot = typeof snapshot === "string" && snapshot.length > 0;
  const srcDoc = hasSnapshot
    ? `<style>html,body{margin:0}body::-webkit-scrollbar{display:none}body{scrollbar-width:none;-ms-overflow-style:none}</style>${snapshot}`
    : "";
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      {hasSnapshot ? (
        <iframe
          srcDoc={srcDoc}
          sandbox=""
          title={`Widget snapshot — ${label}`}
          className="w-full h-80 rounded border bg-background"
        />
      ) : (
        <div className="w-full h-80 rounded border bg-background/40 flex items-center justify-center text-muted-foreground italic text-[11px]">
          (no snapshot)
        </div>
      )}
    </div>
  );
}
