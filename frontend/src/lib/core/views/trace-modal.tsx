/**
 * State-driven test result viewer. Renders a recorded Trace + replay
 * Trace + Verdict into a single dialog. Each step shows its action and
 * any drifts that landed at its index. The footer summarises the final
 * scoreboard.
 *
 * Smoke-tested via `pnpm dev` (Phase 7); no RTL tests in this
 * codebase.
 */

import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  XCircle,
  XIcon,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Action, Drift, State, Step, Trace, Verdict } from "../types";

interface Props {
  recorded: Trace | null;
  replayed: Trace | null;
  verdict: Verdict | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function TraceModal({
  recorded,
  replayed,
  verdict,
  open,
  onOpenChange,
}: Props) {
  if (!recorded || !replayed || !verdict) return null;

  const driftsByStep = groupDriftsByStep(verdict.drifts);
  const finalState = replayed.steps.at(-1)?.stateAfter ?? replayed.initialState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-0 right-0 z-50 h-screen w-[720px] max-w-[95vw] bg-popover text-sm border-l shadow-2xl flex flex-col"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b">
            <DialogPrimitive.Title className="text-sm font-medium">
              {recorded.name} — {verdict.ok ? "PASS" : "FAIL"}{" "}
              <span className="text-xs text-muted-foreground">
                ({verdict.drifts.length} drifts)
              </span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          </header>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {replayed.steps.map((step, i) => (
              <StepRow
                key={i}
                index={i}
                step={step}
                drifts={driftsByStep.get(i) ?? []}
              />
            ))}
            {replayed.steps.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                no steps captured
              </p>
            )}
          </div>

          <footer className="border-t px-4 py-3">
            <Scoreboard state={finalState} />
          </footer>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

function StepRow({
  index,
  step,
  drifts,
}: {
  index: number;
  step: Step;
  drifts: Drift[];
}) {
  const ok = drifts.length === 0;
  // Open failed steps by default so the user sees the drift inline;
  // user can collapse them, or expand passing steps for inspection.
  const [open, setOpen] = useState(!ok);
  return (
    <div className="text-xs font-mono border-b border-border/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left py-1.5 px-1 flex items-center gap-2 hover:bg-muted/30 cursor-pointer"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        )}
        {ok ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        )}
        <span className="text-muted-foreground/60 w-8 text-right">
          {index + 1}
        </span>
        <span className="w-32 truncate text-[10px] uppercase tracking-wider">
          {actionLabel(step.action)}
        </span>
        <span className="truncate flex-1 text-left">
          {actionSummary(step.action)}
        </span>
      </button>
      {open && (
        <div className="ml-12 mr-1 pb-2 space-y-2">
          {drifts.length > 0 && (
            <div className="space-y-1.5">
              {drifts.map((d, j) => (
                <DriftBlock key={j} drift={d} />
              ))}
            </div>
          )}
          <ActionDetails action={step.action} />
        </div>
      )}
    </div>
  );
}

function DriftBlock({ drift }: { drift: Drift }) {
  return (
    <div className="text-[10px] font-mono border-l-2 border-red-400/40 pl-2 py-1 bg-red-500/5 rounded-sm">
      <div className="text-red-400">
        <span className="opacity-60">{drift.reason}</span>{" "}
        <span className="font-semibold">{drift.path || "(step)"}</span>
      </div>
      <div className="mt-0.5 text-muted-foreground">
        <span className="opacity-60 w-16 inline-block">expected:</span>{" "}
        <span className="text-foreground/80 whitespace-pre-wrap break-all">
          {fmt(drift.expected)}
        </span>
      </div>
      <div className="text-muted-foreground">
        <span className="opacity-60 w-16 inline-block">got:</span>{" "}
        <span className="text-foreground/80 whitespace-pre-wrap break-all">
          {fmt(drift.actual)}
        </span>
      </div>
    </div>
  );
}

function ActionDetails({ action }: { action: Action }) {
  return (
    <div className="text-[10px] font-mono">
      <div className="text-muted-foreground/60 uppercase tracking-wider mb-0.5">
        action payload
      </div>
      <pre className="text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 p-2 rounded max-h-64 overflow-auto">
        {JSON.stringify(action.payload, null, 2)}
      </pre>
    </div>
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

function actionLabel(a: Action): string {
  return `${a.driver}.${a.kind}`;
}

function actionSummary(a: Action): string {
  if (a.driver === "studio" && a.kind === "select") {
    return a.payload.selection?.name ?? "(cleared)";
  }
  if (a.driver === "mcp" && a.kind === "request") {
    const name = (a.payload.params as { name?: unknown } | null)?.name;
    return typeof name === "string"
      ? `${a.payload.method} ${name}`
      : a.payload.method;
  }
  if (a.driver === "mcp" && a.kind === "response") {
    return a.payload.error ? `error: ${a.payload.error.message}` : "ok";
  }
  if (a.driver === "widget" && a.kind === "opened") {
    return a.payload.uri;
  }
  if (a.driver === "widget" && a.kind.startsWith("dom.")) {
    const sel = (
      a.payload as {
        selectors?: { testid?: string; aria?: { label?: string } };
      }
    ).selectors;
    return sel?.testid ?? sel?.aria?.label ?? "(selector)";
  }
  return "";
}

function fmt(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    // Pretty-print objects/arrays. Two-space indent reads cleanly inside
    // the drift block; `whitespace-pre-wrap` on the parent preserves it.
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
