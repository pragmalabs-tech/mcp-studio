import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReplayReport } from "@/lib/engine/report";
import type { StepResult } from "@/lib/engine/engine";
import { KIND_BG } from "@/lib/engine/kind-colors";
import { KIND } from "@/lib/recorder/kinds";
import { verbalize } from "@/lib/recorder/summarize";
import { isObservation } from "@/components/studio/tests-page";

interface Props {
  report: ReplayReport;
  hideObservations: boolean;
  onJumpToStep?: (stepIndex: number) => void;
}

/** Wall-clock pause between events when the user clicks Play. Long enough
 *  that a human can read each step's data card before the cursor advances.
 *  Use the Step / chevron buttons (or click the track) for manual control. */
const STEP_DELAY_MS = 800;

function fmtTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function statusOutline(status: StepResult["status"]): string {
  if (status === "fail" || status === "timeout") return "ring-1 ring-red-400";
  if (status === "skip") return "opacity-40";
  return "";
}

/** A kind-specific data card rendered next to the cursor in the preview area.
 *  Lets the user see WHAT happened at a given point, not just WHERE on the
 *  timeline. */
function CursorEventCard({ step }: { step: StepResult }) {
  const action = step.action;
  const obs = step.observation as Record<string, unknown> | undefined;

  // mcp.request — show method, params, and (if observed) the response shape.
  if (action.kind === KIND.MCP_REQUEST) {
    const response = obs as
      | {
          result?: unknown;
          error?: { message: string };
          durationMs?: number;
          skipped?: string;
        }
      | undefined;
    return (
      <div className="space-y-1.5">
        <Field label="method" value={action.method} mono />
        <Field label="source" value={action.source} mono />
        <Field label="params" value={previewJson(action.params)} mono code />
        {response?.error ? (
          <Field
            label="response"
            value={`error: ${response.error.message}`}
            mono
            tone="error"
          />
        ) : response?.skipped ? (
          <Field label="response" value={response.skipped} mono tone="dim" />
        ) : response?.result !== undefined ? (
          <Field
            label="response"
            value={previewJson(response.result)}
            mono
            code
          />
        ) : null}
      </div>
    );
  }

  if (action.kind === KIND.MCP_RESPONSE) {
    return (
      <div className="space-y-1.5">
        <Field label="paired with" value={`#${action.requestId}`} mono />
        <Field
          label="duration"
          value={`${action.durationMs.toFixed(0)}ms`}
          mono
        />
        {action.error ? (
          <Field label="error" value={action.error.message} mono tone="error" />
        ) : (
          <Field label="result" value={previewJson(action.result)} mono code />
        )}
      </div>
    );
  }

  if (action.kind === KIND.WIDGET_RENDER_COMPLETE) {
    return (
      <div className="space-y-1.5">
        <Field label="bodyChars" value={String(action.bodyChars)} mono />
        <Field
          label="renderDuration"
          value={`${action.renderDurationMs.toFixed(0)}ms`}
          mono
        />
        {action.hasRuntimeErrors && (
          <Field label="runtime" value="errors detected" mono tone="error" />
        )}
      </div>
    );
  }

  if (action.kind.startsWith("widget.dom.")) {
    const a = action as {
      selectors?: {
        testid?: string;
        aria?: { label?: string };
        text?: { tag: string; value: string };
        css?: string;
      };
      value?: string;
      key?: string;
    };
    const sel = a.selectors;
    const target = sel?.testid
      ? `[testid=${sel.testid}]`
      : sel?.aria?.label
        ? `[aria=${sel.aria.label}]`
        : sel?.text
          ? `${sel.text.tag}:"${sel.text.value}"`
          : (sel?.css ?? "(unresolved)");
    const ack = obs as
      | { ok?: boolean; mutated?: boolean; reason?: string }
      | undefined;
    return (
      <div className="space-y-1.5">
        <Field label="target" value={target} mono />
        {a.value !== undefined && (
          <Field label="value" value={JSON.stringify(a.value)} mono />
        )}
        {a.key && <Field label="key" value={a.key} mono />}
        {ack && (
          <Field
            label="ack"
            value={
              ack.ok === false
                ? `ko: ${ack.reason ?? "no reason"}`
                : `ok${ack.mutated ? " · DOM mutated" : ""}`
            }
            mono
            tone={ack.ok === false ? "error" : undefined}
          />
        )}
      </div>
    );
  }

  // sidebar.select / editor.set_args / config.update / auth.update — just the
  // recorded payload, no observation.
  return (
    <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 p-2 rounded">
      {JSON.stringify(action, null, 2)}
    </pre>
  );
}

function Field({
  label,
  value,
  mono,
  code,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  code?: boolean;
  tone?: "error" | "dim";
}) {
  const valColor =
    tone === "error"
      ? "text-red-400"
      : tone === "dim"
        ? "text-muted-foreground/70"
        : "text-foreground";
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="text-muted-foreground w-24 shrink-0 uppercase tracking-wider text-[9px] font-semibold pt-0.5">
        {label}
      </span>
      {code ? (
        <pre
          className={`${mono ? "font-mono" : ""} ${valColor} whitespace-pre-wrap break-all bg-muted/30 px-1.5 py-1 rounded flex-1 max-h-32 overflow-auto`}
        >
          {value}
        </pre>
      ) : (
        <span
          className={`${mono ? "font-mono" : ""} ${valColor} truncate flex-1`}
          title={value}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function previewJson(v: unknown): string {
  if (v === undefined) return "undefined";
  try {
    const json = JSON.stringify(v, null, 2);
    return json.length > 600 ? json.slice(0, 600) + "\n…(truncated)" : json;
  } catch {
    return String(v);
  }
}

/** Find the most recent widget.render step at or before step index i. */
function renderAtIndex(report: ReplayReport, i: number): StepResult | null {
  let best: StepResult | null = null;
  for (let k = 0; k <= i && k < report.steps.length; k++) {
    if (report.steps[k].action.kind === KIND.WIDGET_RENDER) {
      best = report.steps[k];
    }
  }
  return best;
}

export function TestResultPlayer({
  report,
  hideObservations,
  onJumpToStep,
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = report.steps.length;

  /** Current cursor: integer step index in [0..total]. `total` means
   *  "past the last step" (replay finished). */
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);

  /** DOM html shown in the inline preview iframe. Updates as cursor crosses
   *  widget.render boundaries. Empty until first render. */
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const lastRenderIndexRef = useRef<number | null>(null);

  /** Map an event index to its slot {left%, width%} on the track.
   *  Equal width per event — pacing is decoupled from recorded `relMs`. */
  function slot(i: number): { left: string; width: string } {
    const w = total > 0 ? 100 / total : 100;
    return { left: `${i * w}%`, width: `${w}%` };
  }

  /** Step the cursor is sitting on (or null if past the end). */
  const cursorStep = useMemo<StepResult | null>(() => {
    if (cursor < 0 || cursor >= total) return null;
    return report.steps[cursor];
  }, [cursor, total, report]);

  /** Update the preview html when the cursor crosses into a different
   *  widget.render boundary. */
  useEffect(() => {
    const render = renderAtIndex(report, cursor);
    const idx = render ? render.index : null;
    if (idx === lastRenderIndexRef.current) return;
    lastRenderIndexRef.current = idx;
    const snap = render
      ? (report.artifacts.previews?.[render.index]?.domSnapshot ?? "")
      : "";
    setPreviewHtml(snap);
  }, [cursor, report]);

  /** Drive the cursor one step at a time when playing. */
  useEffect(() => {
    if (!playing) return;
    if (cursor >= total) {
      setPlaying(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      setCursor((c) => Math.min(c + 1, total));
    }, STEP_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playing, cursor, total]);

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!trackRef.current || total === 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.min(total - 1, Math.floor(frac * total));
    setPlaying(false);
    setCursor(idx);
  }

  function handlePlayPause() {
    if (cursor >= total) setCursor(0);
    setPlaying((v) => !v);
  }

  function handleReset() {
    setPlaying(false);
    setCursor(0);
  }

  function handleStepBack() {
    setPlaying(false);
    setCursor((c) => Math.max(0, c - 1));
  }

  function handleStepForward() {
    setPlaying(false);
    setCursor((c) => Math.min(total - 1, c + 1));
  }

  // The cursor's pixel x is the LEFT edge of its slot, except past-the-end
  // which sits at 100%.
  const cursorLeftPct =
    total === 0 ? 0 : Math.min(cursor, total) * (100 / total);

  return (
    <div className="border-b text-xs">
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Timeline
        </span>
        <span className="text-muted-foreground font-mono">
          step {Math.min(cursor + 1, total)} / {total}
          {cursorStep && (
            <span className="ml-2 text-muted-foreground/60">
              · t={fmtTime(cursorStep.action.relMs)}
            </span>
          )}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleReset}
          title="Reset to step 1"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleStepBack}
          disabled={cursor <= 0}
          title="Previous step"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleStepForward}
          disabled={cursor >= total - 1}
          title="Next step"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={playing ? "destructive" : "default"}
          size="sm"
          onClick={handlePlayPause}
          title={playing ? "Pause" : "Play step-by-step (auto-advance)"}
        >
          {playing ? (
            <>
              <Pause className="h-3.5 w-3.5 mr-1.5 fill-current" />
              Pause
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />
              {cursor >= total ? "Replay" : "Play"}
            </>
          )}
        </Button>
      </div>

      {/* Step-index axis: shows step numbers at quartile marks. */}
      <div className="relative h-4 mx-3 text-[9px] text-muted-foreground/70 font-mono">
        {total > 0 &&
          [0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const idx = Math.min(Math.round(frac * (total - 1)) + 1, total);
            return (
              <div
                key={frac}
                className="absolute top-0"
                style={{
                  left: `${frac * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                #{idx}
              </div>
            );
          })}
      </div>

      {/* Track — equal-width slots per event. */}
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className="relative mx-3 mb-3 h-7 bg-muted/30 rounded cursor-crosshair"
      >
        {report.steps.map((s) => {
          const obs = isObservation(s.action);
          const { left, width } = slot(s.index);
          if (hideObservations && obs) {
            // dim, narrow marker centered in its slot so the slot is still
            // there (positions stay stable as the filter toggles).
            return (
              <div
                key={s.index}
                className="absolute top-1 bottom-1 bg-muted-foreground/15 rounded-sm"
                style={{ left, width }}
              />
            );
          }
          const bg = KIND_BG[s.action.kind] ?? "bg-muted";
          const outline = statusOutline(s.status);
          return (
            <button
              key={s.index}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onJumpToStep?.(s.index);
                setCursor(s.index);
              }}
              title={`#${s.index + 1} · ${verbalize(s.action)} · ${s.durationMs.toFixed(0)}ms`}
              className={`absolute top-0.5 bottom-0.5 rounded-sm hover:brightness-125 transition ${bg} ${outline}`}
              style={{
                // tiny inset so adjacent blocks have a hair of separation
                left: `calc(${left} + 1px)`,
                width: `calc(${width} - 2px)`,
              }}
            />
          );
        })}

        {/* Cursor — sits on the LEFT edge of the current step's slot. */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none transition-[left] duration-150 ease-out"
          style={{ left: `${cursorLeftPct}%` }}
        />
      </div>

      {/* Preview pane — visual widget snapshot at the cursor's most recent
          widget.render boundary, plus a kind-specific data card for whatever
          step the cursor is currently sitting on. */}
      <div className="px-3 pb-3 space-y-2">
        {previewHtml ? (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              widget preview
            </div>
            <iframe
              title="Cursor render preview"
              sandbox=""
              srcDoc={previewHtml}
              className="w-full h-56 rounded border border-border/40 bg-white"
            />
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground italic">
            Widget preview appears once the cursor reaches a widget.render step.
          </div>
        )}

        {cursorStep && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <span>at cursor</span>
              <span className="text-muted-foreground/60 font-mono">
                #{cursorStep.index + 1}
              </span>
              <span className="font-mono text-muted-foreground/60">
                {cursorStep.action.kind}
              </span>
              <span className="text-muted-foreground/60 font-mono">
                · {cursorStep.durationMs.toFixed(0)}ms
              </span>
            </div>
            <div className="bg-muted/20 rounded p-2">
              <CursorEventCard step={cursorStep} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
