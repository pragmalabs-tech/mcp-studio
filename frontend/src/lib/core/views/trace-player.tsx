/**
 * Video-style playback controls for a replay Trace.
 *
 * Pure UI - owns no state. Parent owns `selectedIdx`, `isPlaying`,
 * `speed` and runs the auto-advance loop. The player just renders
 * controls + a scrubber and calls back when the user interacts.
 *
 * Scrubber ticks are colored by the verdict at each step so a viewer
 * can scan where the failures land at a glance.
 */

import { ChevronLeft, ChevronRight, Pause, Play, SkipBack } from "lucide-react";
import type { Drift, Step } from "../types";

export type PlayerSpeed = 1 | 2 | 4;

export interface TracePlayerProps {
  steps: readonly Step[];
  driftsByStep: Map<number, Drift[]>;
  selectedIdx: number;
  onSelect(idx: number): void;
  isPlaying: boolean;
  onPlayPauseToggle(): void;
  speed: PlayerSpeed;
  onSpeedChange(speed: PlayerSpeed): void;
}

const SPEEDS: PlayerSpeed[] = [1, 2, 4];

export function TracePlayer({
  steps,
  driftsByStep,
  selectedIdx,
  onSelect,
  isPlaying,
  onPlayPauseToggle,
  speed,
  onSpeedChange,
}: TracePlayerProps) {
  const total = steps.length;
  const atStart = selectedIdx <= 0;
  const atEnd = selectedIdx >= total - 1;
  const disabled = total === 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0 bg-secondary/30">
      <button
        type="button"
        onClick={() => onSelect(0)}
        disabled={disabled || atStart}
        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
        title="Restart"
      >
        <SkipBack className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onSelect(Math.max(0, selectedIdx - 1))}
        disabled={disabled || atStart}
        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
        title="Previous step"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onPlayPauseToggle}
        disabled={disabled}
        className="text-foreground hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="h-5 w-5" />
        )}
      </button>
      <button
        type="button"
        onClick={() => onSelect(Math.min(total - 1, selectedIdx + 1))}
        disabled={disabled || atEnd}
        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
        title="Next step"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-16 shrink-0">
        {Math.min(selectedIdx + 1, total)} / {total}
      </span>

      <Scrubber
        steps={steps}
        driftsByStep={driftsByStep}
        selectedIdx={selectedIdx}
        onSelect={onSelect}
      />

      <div className="flex items-center gap-0.5 text-[11px] font-mono shrink-0">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeedChange(s)}
            className={`px-1.5 py-0.5 rounded ${
              s === speed
                ? "bg-primary/20 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
            title={`${s}x speed`}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

function Scrubber({
  steps,
  driftsByStep,
  selectedIdx,
  onSelect,
}: {
  steps: readonly Step[];
  driftsByStep: Map<number, Drift[]>;
  selectedIdx: number;
  onSelect(idx: number): void;
}) {
  if (steps.length === 0) {
    return <div className="flex-1" />;
  }
  return (
    <div
      className="flex-1 flex items-center gap-[2px] h-6"
      role="slider"
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-valuenow={selectedIdx + 1}
    >
      {steps.map((_, i) => {
        const failed = (driftsByStep.get(i) ?? []).length > 0;
        const isCurrent = i === selectedIdx;
        const isPast = i < selectedIdx;
        let tone = "bg-emerald-500/40 hover:bg-emerald-500/70";
        if (failed) tone = "bg-red-500/50 hover:bg-red-500/80";
        if (isCurrent) tone = failed ? "bg-red-400" : "bg-emerald-400";
        if (!isCurrent && !isPast && !failed) {
          tone = "bg-muted-foreground/20 hover:bg-muted-foreground/40";
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={`flex-1 transition-colors cursor-pointer ${
              isCurrent ? "h-5" : "h-2.5 hover:h-3.5"
            } rounded-sm ${tone}`}
            title={`Step ${i + 1}${failed ? " (drifts)" : ""}`}
            aria-label={`Jump to step ${i + 1}`}
          />
        );
      })}
    </div>
  );
}
