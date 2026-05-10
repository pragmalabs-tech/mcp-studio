import { useState } from "react";
import { Clock, FlaskConical, History, Circle, Square } from "lucide-react";
import { RecordingHistoryDialog } from "@/components/studio/recording-history-dialog";
import { TestsPage } from "@/components/studio/tests-page";
import { ReportsPage } from "@/components/studio/reports-page";
import { SaveTestModal } from "@/components/studio/save-test-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStudioStore } from "@/lib/studio/store";
import { recorder } from "@/lib/recorder/bus";

export function TopHeader() {
  const slicingState = useStudioStore((s) => s.slicingState);
  const setSlicingState = useStudioStore((s) => s.setSlicingState);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [testsOpen, setTestsOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
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
      </div>

      <div className="flex-1" />

      {/* Test record + saved tests + reports — the top bar's whole job is
          test ergonomics now that profile/cloud/auth live in the sidebar. */}
      {!slicingState ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleStartRecording}
          title="Start a named test by recording the next series of actions"
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

      <button
        type="button"
        onClick={() => setReportsOpen(true)}
        title="Past test runs and reports"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <History className="h-4 w-4" />
        Reports
      </button>

      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        title="View recorded actions"
        className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <Clock className="h-4 w-4" />
      </button>

      <RecordingHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />

      <TestsPage open={testsOpen} onOpenChange={setTestsOpen} />
      <ReportsPage open={reportsOpen} onOpenChange={setReportsOpen} />

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
          }}
        />
      )}
    </header>
  );
}
