import { useState } from "react";
import {
  FastForward,
  FlaskConical,
  Circle,
  SkipForward,
  Square,
} from "lucide-react";
import { TestsPage } from "@/components/studio/tests-page";
import { SaveTestModal } from "@/components/studio/save-test-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStudioStore, type RunState } from "@/lib/studio/store";
import { useMcpHealth } from "@/lib/studio/health";
import { recorder } from "@/lib/recorder/bus";
import { actionLabel, actionSummary } from "@/lib/core/action-format";
import type { McpHealth } from "@/lib/studio/api";

export function TopHeader() {
  const slicingState = useStudioStore((s) => s.slicingState);
  const setSlicingState = useStudioStore((s) => s.setSlicingState);
  const runState = useStudioStore((s) => s.runState);
  const patchRunState = useStudioStore((s) => s.patchRunState);
  const { status: healthStatus } = useMcpHealth();
  // Gate destructive / network-bound controls on the server being live.
  // Stop Record stays enabled while disconnected so an in-flight slice
  // can still be saved locally.
  const recordDisabled = healthStatus !== "connected" && !slicingState;

  const [testsOpen, setTestsOpen] = useState(false);
  const [recordExplainerOpen, setRecordExplainerOpen] = useState(false);
  const [saveTestOpen, setSaveTestOpen] = useState(false);
  const [saveRange, setSaveRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  function handleStartRecording() {
    // Always show the explainer — the description has real content (file
    // location, replay modes, redaction note) and recording is intentional
    // enough to warrant a confirmation step.
    setRecordExplainerOpen(true);
  }

  function beginSlice() {
    setSlicingState({
      startIndex: recorder.markIndex(),
      startedAt: new Date().toISOString(),
    });
    setRecordExplainerOpen(false);
  }

  function handleStopRecording() {
    if (!slicingState) return;
    setSaveRange({ start: slicingState.startIndex, end: recorder.markIndex() });
    setSaveTestOpen(true);
  }

  return (
    <header className="h-12 shrink-0 border-b flex items-center px-3 gap-2">
      {/* Left: logo */}
      <div className="flex items-center gap-2">
        <img
          src="/pragmalabs.png"
          alt="Pragma Labs"
          className="w-6 h-6 rounded"
        />
        <span className="font-semibold text-sm">mcp studio</span>
        <HealthDot />
      </div>

      {/* When a replay is in flight, the header shows live progress +
          step controls instead of the normal record/tests/history. The
          test catalog is hidden during a run to discourage stacking. */}
      {runState ? (
        <RunBar state={runState} patch={patchRunState} />
      ) : (
        <>
          <div className="flex-1" />

          {/* Test record + saved tests + reports — the top bar's whole job
              is test ergonomics now that profile/cloud/auth live in the
              sidebar. */}
          {!slicingState ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartRecording}
              disabled={recordDisabled}
              title={
                recordDisabled
                  ? "MCP server not reachable - reconnect to record"
                  : "Start a named test by recording the next series of actions"
              }
            >
              <Circle className="h-3.5 w-3.5 mr-1.5" />
              Record Test
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStopRecording}
              title="Stop and save the recorded actions as a test"
            >
              <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
              Stop Record Test
            </Button>
          )}

          <button
            type="button"
            onClick={() => setTestsOpen(true)}
            title="Saved tests"
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <FlaskConical className="h-4 w-4" />
            Tests
          </button>
        </>
      )}

      <TestsPage open={testsOpen} onOpenChange={setTestsOpen} />

      {saveRange && (
        <SaveTestModal
          open={saveTestOpen}
          startIndex={saveRange.start}
          endIndex={saveRange.end}
          onOpenChange={(v) => {
            setSaveTestOpen(v);
            if (!v) {
              setSaveRange(null);
              setSlicingState(null);
            }
          }}
          onSaved={() => {
            setSaveTestOpen(false);
            setSaveRange(null);
            setSlicingState(null);
            // Pop the Tests drawer so the user sees the new test land.
            setTestsOpen(true);
          }}
        />
      )}

      <Dialog open={recordExplainerOpen} onOpenChange={setRecordExplainerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Circle className="h-4 w-4" />
              Record a test
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm text-muted-foreground">
            <p>
              Studio captures every interaction in the background - tool calls,
              widget renders, clicks and inputs inside widgets.
              <span className="text-foreground font-medium"> Record Test </span>
              marks the start of a slice. Drive Studio through the flow you want
              to test, then press
              <span className="text-foreground font-medium">
                {" "}
                Stop Record Test{" "}
              </span>
              to name and save it as a JSON file in
              <span className="font-mono text-foreground">
                {" "}
                ~/.mcp-studio/tests/
              </span>
              .
            </p>
            <p>
              Saved tests live in the
              <span className="text-foreground font-medium"> Tests </span>
              drawer (flask icon). From there you can
              <span className="text-foreground font-medium"> Run </span>
              one back end-to-end, or
              <span className="text-foreground font-medium"> Step </span>
              through it action-by-action like a debugger. The result modal
              shows a per-step pass/fail timeline with a sandboxed preview of
              every widget render.
            </p>
            <p className="text-xs italic">
              Auth tokens are redacted on save - Studio uses your live token
              when replaying.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRecordExplainerOpen(false)}
            >
              Not now
            </Button>
            <Button size="sm" onClick={beginSlice}>
              Start recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

const HEALTH_LABELS: Record<McpHealth, string> = {
  checking: "Checking MCP server...",
  connected: "MCP server reachable",
  unauthorized: "Auth required (401) - click to recheck",
  disconnected: "MCP server unreachable - click to retry",
};

const HEALTH_TONES: Record<McpHealth, string> = {
  checking: "text-muted-foreground",
  connected: "text-emerald-400",
  unauthorized: "text-amber-400",
  disconnected: "text-red-400",
};

function RunBar({
  state,
  patch,
}: {
  state: RunState;
  patch: (p: Partial<RunState>) => void;
}) {
  const pct =
    state.totalSteps > 0
      ? Math.round(
          (Math.max(0, state.currentStep + 1) / state.totalSteps) * 100,
        )
      : 0;
  const paused = state.nextResolver !== null;
  const next = () => {
    state.nextResolver?.();
    patch({ nextResolver: null });
  };
  const autoFromHere = () => {
    state.nextResolver?.();
    patch({ mode: "auto", nextResolver: null });
  };
  const stop = () => {
    state.ctrl.abort();
    state.nextResolver?.();
  };
  return (
    <div className="flex-1 flex items-center gap-3 min-w-0">
      <span className="inline-flex items-center gap-1.5 shrink-0">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
          {state.mode === "step" ? "Step mode" : "Replaying"}
        </span>
      </span>
      <span className="text-sm font-medium truncate max-w-[14rem]">
        {state.testName}
      </span>
      <span className="text-xs text-muted-foreground font-mono shrink-0">
        step {Math.max(0, state.currentStep + 1)} / {state.totalSteps} · {pct}%
      </span>
      {state.currentAction && (
        <span className="text-xs text-muted-foreground font-mono truncate flex-1 min-w-0">
          {actionLabel(state.currentAction)}
          {actionSummary(state.currentAction) && (
            <span className="text-muted-foreground/60">
              {" · "}
              {actionSummary(state.currentAction)}
            </span>
          )}
        </span>
      )}
      {!state.currentAction && <div className="flex-1" />}
      {state.mode === "step" && (
        <>
          <Button size="sm" onClick={next} disabled={!paused}>
            <SkipForward className="h-3.5 w-3.5 mr-1.5" />
            Next
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={autoFromHere}
            disabled={!paused}
            title="Switch to autoplay"
          >
            <FastForward className="h-3.5 w-3.5 mr-1.5" />
            Auto
          </Button>
        </>
      )}
      <Button variant="destructive" size="sm" onClick={stop}>
        <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
        Stop
      </Button>
    </div>
  );
}

function HealthDot() {
  const { status, recheck } = useMcpHealth();
  return (
    <button
      type="button"
      onClick={recheck}
      title={HEALTH_LABELS[status]}
      aria-label={HEALTH_LABELS[status]}
      className={`inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-muted/50 transition-colors ${HEALTH_TONES[status]}`}
    >
      <span
        className={`block h-2 w-2 rounded-full bg-current ${
          status === "checking" ? "animate-pulse" : ""
        }`}
      />
    </button>
  );
}
