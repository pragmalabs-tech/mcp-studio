import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Play, StepForward, XIcon } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Trace } from "@/lib/core/types";
import { resolveRules } from "@/lib/core/rules";
import { ActionList } from "./tests-page";
import { StepInspectorDetail } from "./step-inspector-detail";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trace: Trace | null;
  onRun?: (mode: "auto" | "step") => void;
}

export function TestInspectorDialog({
  open,
  onOpenChange,
  trace,
  onRun,
}: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!trace || trace.steps.length === 0) {
      setSelectedIdx(null);
      return;
    }
    setSelectedIdx(0);
  }, [trace]);

  const resolvedRules = useMemo(
    () => (trace ? resolveRules(trace) : null),
    [trace],
  );

  const selectedStep =
    trace && selectedIdx !== null ? trace.steps[selectedIdx] : null;
  const prevStateAfter =
    trace && selectedIdx !== null
      ? selectedIdx === 0
        ? trace.initialState
        : trace.steps[selectedIdx - 1].stateAfter
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-0 right-0 z-50 h-screen w-[960px] max-w-[95vw] bg-popover text-sm text-popover-foreground border-l shadow-2xl outline-none flex flex-col data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right duration-150"
        >
          <header className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
            <DialogPrimitive.Title className="text-sm font-medium truncate flex-1">
              {trace ? trace.name || "Test inspector" : "Test inspector"}
              {trace && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {trace.steps.length} step{trace.steps.length === 1 ? "" : "s"}
                </span>
              )}
            </DialogPrimitive.Title>
            {onRun && trace && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onRun("auto");
                  }}
                  title="Replay this test (auto)"
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Run
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onRun("step");
                  }}
                  title="Step through manually"
                >
                  <StepForward className="h-3.5 w-3.5 mr-1.5" />
                  Step
                </Button>
              </>
            )}
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </header>

          <div className="flex-1 min-h-0 flex">
            <div className="w-[360px] shrink-0 border-r overflow-y-auto">
              {trace ? (
                <ActionList
                  steps={trace.steps}
                  selectedIdx={selectedIdx ?? undefined}
                  onSelect={setSelectedIdx}
                />
              ) : (
                <p className="px-4 py-3 text-xs text-muted-foreground italic">
                  No trace loaded.
                </p>
              )}
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              {selectedStep && resolvedRules ? (
                <StepInspectorDetail
                  step={selectedStep}
                  prevStateAfter={prevStateAfter}
                  resolvedRules={resolvedRules}
                />
              ) : (
                <p className="px-4 py-3 text-xs text-muted-foreground italic">
                  Select a step on the left to inspect it.
                </p>
              )}
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
