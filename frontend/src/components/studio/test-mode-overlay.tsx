import { useEffect, useState } from "react";
import { Square, SkipForward, FastForward, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudioStore } from "@/lib/studio/store";
import { runtime, type ProgressSnapshot } from "@/lib/engine/runtime";

export function TestModeOverlay() {
  const studioMode = useStudioStore((s) => s.studioMode);
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(
    runtime.current,
  );

  useEffect(() => {
    return runtime.subscribe(setSnapshot);
  }, []);

  if (studioMode !== "test") return null;

  const progressPct =
    snapshot && snapshot.total > 0
      ? Math.round((snapshot.index / snapshot.total) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-40 bg-background/30 backdrop-blur-[1px] flex flex-col">
      {/* swallow all events under the overlay */}
      <div
        className="absolute inset-0"
        onClickCapture={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onKeyDownCapture={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        tabIndex={-1}
      />
      <div className="relative z-10 px-4 py-2 bg-popover border-b shadow-md flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            Test mode
          </span>
        </span>
        {snapshot && (
          <>
            <span className="text-sm font-medium truncate max-w-xs">
              {snapshot.testName}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              step {snapshot.index} / {snapshot.total} · {progressPct}%
            </span>
            {snapshot.current && (
              <span className="text-xs text-muted-foreground font-mono truncate flex-1">
                {snapshot.current.kind}
              </span>
            )}
          </>
        )}
        <div className="flex-1" />
        {snapshot?.mode === "step" ? (
          <>
            <span className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">
              Step
            </span>
            <Button
              variant="default"
              size="sm"
              onClick={() => runtime.next()}
              title="Run the next action"
            >
              <SkipForward className="h-3.5 w-3.5 mr-1.5" />
              Next
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runtime.setMode("auto")}
              title="Switch to autoplay (no pauses)"
            >
              <FastForward className="h-3.5 w-3.5 mr-1.5" />
              Resume auto
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => runtime.setMode("step")}
            title="Pause and step through manually"
          >
            <Pause className="h-3.5 w-3.5 mr-1.5" />
            Pause
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={() => runtime.abort()}>
          <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
          Stop
        </Button>
      </div>
    </div>
  );
}
