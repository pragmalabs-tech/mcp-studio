/**
 * State-driven test result viewer. Renders a recorded Trace + replay
 * Trace + Verdict into a single dialog. The left pane is a compact
 * step navigator (severity-colored markers + one-line drift summaries
 * on expand); the right pane (StepDetail) carries the full detail —
 * drifts on top with full-width expected/got, then result JSON, then
 * the widget iframe when applicable.
 *
 * Smoke-tested via `pnpm dev`; no RTL tests in this codebase.
 */

import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Settings,
  XCircle,
  XIcon,
  AlertTriangle,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type {
  Drift,
  Matcher,
  State,
  Step,
  Trace,
  TraceRules,
  Verdict,
} from "../types";
import { addIgnore, setMatch } from "../rules";
import { actionLabel, actionSummary, primaryMethods } from "../action-format";
import { RulesEditor } from "@/components/studio/rules-editor";
import { ContentDialog } from "./content-dialog";
import { TracePlayer, type PlayerSpeed } from "./trace-player";
import { StepDetail } from "./step-detail";
import { buildViewable } from "./step-views";

interface Props {
  recorded: Trace | null;
  replayed: Trace | null;
  verdict: Verdict | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Persist a new rule set on the recorded trace and re-diff. Receives
   *  the new TraceRules; caller handles persistence + verdict refresh. */
  onRulesChange?(rules: TraceRules): void | Promise<void>;
  /** Set the per-step compare strategy on the recorded trace and re-diff.
   *  Receives the step index and the new mode. Caller handles
   *  persistence + verdict refresh. */
  onCompareChange?(
    stepIndex: number,
    mode: "exact" | "shape",
  ): void | Promise<void>;
}

type StepSeverity = "fail" | "warn" | "ok";

interface DriftSelection {
  stepIdx: number;
  driftIdxInStep: number;
}

export function TraceModal({
  recorded,
  replayed,
  verdict,
  open,
  onOpenChange,
  onRulesChange,
  onCompareChange,
}: Props) {
  if (!recorded || !replayed || !verdict) return null;

  const finalState = replayed.steps.at(-1)?.stateAfter ?? replayed.initialState;
  const [showIgnored, setShowIgnored] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // Counts: surfaced (non-ignored) by severity; ignored separately.
  const counts = useMemo(() => countDrifts(verdict.drifts), [verdict.drifts]);

  // driftsByStep keeps ALL drifts; StepDetail filters by `showIgnored`.
  const driftsByStep = useMemo(
    () => groupDriftsByStep(verdict.drifts),
    [verdict.drifts],
  );

  const stepSeverities = useMemo(
    () => computeStepSeverities(replayed.steps, driftsByStep),
    [replayed.steps, driftsByStep],
  );

  const ignorePath = onRulesChange
    ? (path: string) => onRulesChange(addIgnore(recorded.rules, path))
    : undefined;
  const matchPath = onRulesChange
    ? (path: string, matcher: Matcher) =>
        onRulesChange(setMatch(recorded.rules, path, matcher))
    : undefined;

  // Default the selected step to the FIRST failure if any; otherwise the
  // last step. Drift-first focus matches the user's primary intent on
  // opening the modal ("what failed?").
  const initialSelectedIdx = useMemo(
    () => firstFailingStep(stepSeverities) ?? replayed.steps.length - 1,
    [stepSeverities, replayed.steps.length],
  );
  const [selectedIdx, setSelectedIdx] = useState(
    Math.max(0, initialSelectedIdx),
  );

  // When user clicks a drift one-liner in the left pane, remember which
  // drift to scroll into view inside StepDetail. Cleared on next step
  // change so re-selecting the same step doesn't re-scroll forever.
  const [pendingScrollDrift, setPendingScrollDrift] =
    useState<DriftSelection | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlayerSpeed>(1);
  useEffect(() => {
    if (open) {
      setSelectedIdx(Math.max(0, initialSelectedIdx));
      setIsPlaying(false);
      setPendingScrollDrift(null);
    }
  }, [open, replayed, initialSelectedIdx]);

  // Auto-advance loop. Each step lingers long enough for a viewer to
  // read it; steps with drifts hold a touch longer so the failure is
  // visible.
  useEffect(() => {
    if (!isPlaying) return;
    if (selectedIdx >= replayed.steps.length - 1) {
      setIsPlaying(false);
      return;
    }
    const base = 1200 / speed;
    const failed = stepSeverities[selectedIdx] === "fail";
    const delay = failed ? base * 1.6 : base;
    const t = setTimeout(() => setSelectedIdx((i) => i + 1), delay);
    return () => clearTimeout(t);
  }, [isPlaying, selectedIdx, speed, replayed.steps.length, stepSeverities]);

  const stepCount = replayed.steps.length;

  const handlePlayPauseToggle = () => {
    if (!isPlaying && selectedIdx >= stepCount - 1) setSelectedIdx(0);
    setIsPlaying((p) => !p);
  };

  const selectStep = (idx: number) => {
    setSelectedIdx(idx);
    setIsPlaying(false);
    setPendingScrollDrift(null);
  };

  const selectDrift = (stepIdx: number, driftIdxInStep: number) => {
    setSelectedIdx(stepIdx);
    setIsPlaying(false);
    setPendingScrollDrift({ stepIdx, driftIdxInStep });
  };

  const selectedDrifts = driftsByStep.get(selectedIdx) ?? [];
  const scrollToDriftIdx =
    pendingScrollDrift && pendingScrollDrift.stepIdx === selectedIdx
      ? pendingScrollDrift.driftIdxInStep
      : null;

  const driftsForPlayer = useMemo(
    () => filterPlayerDrifts(verdict.drifts, showIgnored),
    [verdict.drifts, showIgnored],
  );
  const playerDriftsByStep = useMemo(
    () => groupDriftsByStep(driftsForPlayer),
    [driftsForPlayer],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-[2vh] left-1/2 -translate-x-1/2 z-50 h-[96vh] w-[96vw] bg-popover text-sm border rounded-lg shadow-2xl flex flex-col"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-sm font-medium flex items-center gap-2">
                <span>{recorded.name}</span>
                <VerdictBadge ok={verdict.ok} />
                <CountsLine counts={counts} />
              </DialogPrimitive.Title>
              <TraceMeta trace={recorded} />
            </div>
            <div className="flex items-center gap-2">
              {counts.ignored > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowIgnored((v) => !v)}
                  title={
                    showIgnored
                      ? "Hide rule-ignored drifts"
                      : "Show rule-ignored drifts"
                  }
                >
                  {showIgnored ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1 text-xs">
                    {showIgnored
                      ? "Hide ignored"
                      : `Show ignored (${counts.ignored})`}
                  </span>
                </Button>
              )}
              {onRulesChange && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRulesOpen((v) => !v)}
                  title="Edit per-trace assertion rules"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span className="ml-1 text-xs">Rules</span>
                </Button>
              )}
              <DialogPrimitive.Close
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
              </DialogPrimitive.Close>
            </div>
          </header>

          <TracePlayer
            steps={replayed.steps}
            driftsByStep={playerDriftsByStep}
            selectedIdx={selectedIdx}
            onSelect={selectStep}
            isPlaying={isPlaying}
            onPlayPauseToggle={handlePlayPauseToggle}
            speed={speed}
            onSpeedChange={setSpeed}
          />

          <div className="flex-1 min-h-0 flex">
            <div className="w-[360px] shrink-0 flex flex-col border-r">
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {replayed.steps.map((step, i) => (
                  <StepRow
                    key={i}
                    index={i}
                    step={step}
                    allSteps={replayed.steps}
                    drifts={driftsByStep.get(i) ?? []}
                    severity={stepSeverities[i]}
                    showIgnored={showIgnored}
                    isSelected={i === selectedIdx}
                    onSelectStep={() => selectStep(i)}
                    onSelectDrift={(driftIdx) => selectDrift(i, driftIdx)}
                  />
                ))}
                {recorded.steps.slice(replayed.steps.length).map((step, j) => {
                  const i = replayed.steps.length + j;
                  return (
                    <MissingStepRow
                      key={`missing-${i}`}
                      index={i}
                      step={step}
                    />
                  );
                })}
                {replayed.steps.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    no steps captured
                  </p>
                )}
              </div>
              <footer className="border-t px-4 py-3 shrink-0">
                <Scoreboard state={finalState} />
              </footer>
            </div>

            {rulesOpen && onRulesChange ? (
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="px-4 py-2 border-b text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                  Assertion rules
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <RulesEditor trace={recorded} onChange={onRulesChange} />
                </div>
              </div>
            ) : (
              <StepDetail
                steps={replayed.steps}
                selectedStepIdx={selectedIdx}
                drifts={selectedDrifts}
                scrollToDriftIdx={scrollToDriftIdx}
                showIgnored={showIgnored}
                onIgnorePath={ignorePath}
                onMatchPath={matchPath}
                compareMode={recorded.steps[selectedIdx]?.compare ?? "exact"}
                onCompareChange={
                  onCompareChange
                    ? (mode) => onCompareChange(selectedIdx, mode)
                    : undefined
                }
              />
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

function TraceMeta({ trace }: { trace: Trace }) {
  const methods = primaryMethods(trace);
  const captured = useMemo(() => {
    try {
      return new Date(trace.capturedAt).toLocaleString();
    } catch {
      return trace.capturedAt;
    }
  }, [trace.capturedAt]);
  const stepCount = trace.steps.length;
  if (methods.length === 0 && stepCount === 0) return null;
  return (
    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
      {methods.length > 0 && (
        <span>
          tests{" "}
          <span className="font-mono text-foreground/80">
            {methods.join(", ")}
          </span>
          {" · "}
        </span>
      )}
      <span>
        {stepCount} step{stepCount === 1 ? "" : "s"}
      </span>
      <span> · captured {captured}</span>
    </div>
  );
}

function VerdictBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold ${
        ok ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
      }`}
    >
      {ok ? "PASS" : "FAIL"}
    </span>
  );
}

interface Counts {
  fail: number;
  warn: number;
  ignored: number;
}

function CountsLine({ counts }: { counts: Counts }) {
  if (counts.fail === 0 && counts.warn === 0 && counts.ignored === 0) {
    return <span className="text-xs text-muted-foreground">no drifts</span>;
  }
  return (
    <span className="text-xs text-muted-foreground flex items-center gap-2">
      {counts.fail > 0 && (
        <span className="text-red-300">
          ✗ {counts.fail} fail{counts.fail === 1 ? "" : "s"}
        </span>
      )}
      {counts.warn > 0 && (
        <span className="text-yellow-300">⚠ {counts.warn} warn</span>
      )}
    </span>
  );
}

function MissingStepRow({ index, step }: { index: number; step: Step }) {
  return (
    <div className="text-xs font-mono rounded-sm overflow-hidden bg-red-500/5 ring-1 ring-red-500/30">
      <div className="flex items-stretch">
        <div className="w-1 bg-red-400 shrink-0" />
        <div className="flex-1 px-2 py-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-red-300 text-[10px] uppercase tracking-wider font-semibold shrink-0">
              missing
            </span>
            <span className="text-muted-foreground/60 shrink-0">
              {index + 1}
            </span>
            <span className="text-foreground truncate">
              {actionLabel(step.action)}
            </span>
          </div>
          <div className="text-muted-foreground/70 truncate mt-0.5 pl-12 text-[11px]">
            {actionSummary(step.action) || "(no detail)"}
          </div>
          <div className="text-red-300/70 text-[10px] mt-0.5 pl-12">
            recorded but not produced by replay
          </div>
        </div>
      </div>
    </div>
  );
}

function StepRow({
  index,
  step,
  allSteps,
  drifts,
  severity,
  showIgnored,
  isSelected,
  onSelectStep,
  onSelectDrift,
}: {
  index: number;
  step: Step;
  allSteps: readonly Step[];
  drifts: Drift[];
  severity: StepSeverity;
  showIgnored: boolean;
  isSelected: boolean;
  onSelectStep(): void;
  onSelectDrift(driftIdxInStep: number): void;
}) {
  const hasIssues = severity !== "ok";
  const [open, setOpen] = useState(hasIssues);
  const [viewOpen, setViewOpen] = useState(false);

  const viewable = useMemo(
    () => buildViewable(step.action, allSteps, index),
    [step.action, allSteps, index],
  );

  const visibleDrifts = useMemo(
    () =>
      drifts
        .map((d, i) => ({ drift: d, idx: i }))
        .filter(
          ({ drift }) =>
            showIgnored ||
            !drift.suppressedBy ||
            !drift.suppressedBy.layer.endsWith(".ignore"),
        ),
    [drifts, showIgnored],
  );

  const stripeColor =
    severity === "fail"
      ? "bg-red-400"
      : severity === "warn"
        ? "bg-yellow-400"
        : "bg-transparent";

  return (
    <div
      className={`text-xs font-mono rounded-sm overflow-hidden ${
        isSelected
          ? "bg-primary/10 ring-1 ring-primary/30"
          : "hover:bg-muted/20"
      }`}
    >
      <div className="flex items-stretch">
        <div className={`w-1 shrink-0 ${stripeColor}`} />
        <button
          type="button"
          onClick={() => {
            onSelectStep();
            setOpen((v) => !v);
          }}
          className="flex-1 text-left py-1.5 px-1 flex items-center gap-2 cursor-pointer min-w-0"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          )}
          <SeverityIcon severity={severity} />
          <span className="text-muted-foreground/60 w-6 text-right shrink-0">
            {index + 1}
          </span>
          <span className="w-24 truncate text-[10px] uppercase tracking-wider shrink-0">
            {actionLabel(step.action)}
          </span>
          <span className="truncate flex-1 text-left">
            {actionSummary(step.action)}
          </span>
          {visibleDrifts.length > 0 && (
            <span className="text-[9px] opacity-70 shrink-0">
              {visibleDrifts.length}
            </span>
          )}
        </button>
        {viewable && (
          <button
            type="button"
            onClick={() => setViewOpen(true)}
            className="px-1.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/30 shrink-0 flex items-center gap-1"
            title="View content"
          >
            <Eye className="h-3 w-3" />
          </button>
        )}
      </div>
      {open && visibleDrifts.length > 0 && (
        <div className="pl-8 pr-2 pb-1 space-y-0.5">
          {visibleDrifts.map(({ drift, idx }) => (
            <DriftOneLiner
              key={`${idx}-${drift.path}`}
              drift={drift}
              onClick={() => onSelectDrift(idx)}
            />
          ))}
        </div>
      )}
      {viewable && (
        <ContentDialog
          open={viewOpen}
          onOpenChange={setViewOpen}
          title={viewable.title}
          widget={viewable.widget}
          raw={viewable.raw}
        />
      )}
    </div>
  );
}

function SeverityIcon({ severity }: { severity: StepSeverity }) {
  if (severity === "fail")
    return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  if (severity === "warn")
    return <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
}

function DriftOneLiner({ drift, onClick }: { drift: Drift; onClick(): void }) {
  const tier = severityOf(drift);
  const color =
    tier === "fail"
      ? "text-red-300"
      : tier === "warn"
        ? "text-yellow-300"
        : "text-muted-foreground/70";
  const icon = tier === "fail" ? "✗" : tier === "warn" ? "⚠" : "·";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left text-[10px] font-mono ${color} hover:bg-muted/40 rounded px-1.5 py-0.5 truncate`}
      title={drift.path}
    >
      <span className="opacity-60 mr-1">{icon}</span>
      <span className="opacity-60 mr-1">{drift.reason}</span>
      <span>{drift.path || "(step)"}</span>
    </button>
  );
}

function Scoreboard({ state }: { state: State }) {
  const tools = Object.entries(state.tools);
  return (
    <div className="text-[10px] font-mono space-y-0.5">
      <div className="text-muted-foreground uppercase tracking-wider">
        scoreboard
      </div>
      <div>
        network: {state.network.requestCount} req ·{" "}
        {state.network.responseCount} resp · {state.network.errorCount} err
      </div>
      <div>
        widgets: {state.widgets.renderCount} render ·{" "}
        {state.widgets.open.length} open
      </div>
      {tools.length > 0 && (
        <div>
          tools: {tools.map(([name, t]) => `${name}:${t.callCount}`).join(", ")}
        </div>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function groupDriftsByStep(drifts: readonly Drift[]): Map<number, Drift[]> {
  const out = new Map<number, Drift[]>();
  for (const d of drifts) {
    const arr = out.get(d.stepIndex);
    if (arr) arr.push(d);
    else out.set(d.stepIndex, [d]);
  }
  return out;
}

function countDrifts(drifts: readonly Drift[]): Counts {
  let fail = 0;
  let warn = 0;
  let ignored = 0;
  for (const d of drifts) {
    if (d.suppressedBy?.layer.endsWith(".ignore")) ignored++;
    else if (d.severity === "warn") warn++;
    else if (d.severity === "fail") fail++;
  }
  return { fail, warn, ignored };
}

function severityOf(d: Drift): StepSeverity {
  if (d.suppressedBy?.layer.endsWith(".ignore")) return "ok";
  if (d.severity === "warn") return "warn";
  if (d.severity === "fail") return "fail";
  return "ok";
}

function computeStepSeverities(
  steps: readonly Step[],
  driftsByStep: Map<number, Drift[]>,
): StepSeverity[] {
  return steps.map((_, i) => {
    const drifts = driftsByStep.get(i) ?? [];
    let worst: StepSeverity = "ok";
    for (const d of drifts) {
      const s = severityOf(d);
      if (s === "fail") return "fail";
      if (s === "warn") worst = "warn";
    }
    return worst;
  });
}

function firstFailingStep(severities: readonly StepSeverity[]): number | null {
  for (let i = 0; i < severities.length; i++) {
    if (severities[i] === "fail") return i;
  }
  for (let i = 0; i < severities.length; i++) {
    if (severities[i] === "warn") return i;
  }
  return null;
}

function filterPlayerDrifts(
  drifts: readonly Drift[],
  showIgnored: boolean,
): Drift[] {
  return drifts.filter(
    (d) =>
      showIgnored ||
      !d.suppressedBy ||
      !d.suppressedBy.layer.endsWith(".ignore"),
  );
}
