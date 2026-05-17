/**
 * Right pane of the TraceModal. Stacked sections, top-down:
 *   1. Drifts — full-width cards (surfaced first; ignored gated by toggle)
 *   2. Result JSON — pretty-printed for response/request/payload
 *   3. Widget — active widget iframe if the step is widget-rendering
 *
 * Sections render only when they have content; the right pane never
 * shows an empty panel.
 */

import { useEffect, useMemo, useRef } from "react";
import { CspFindingsList } from "./csp-findings";
import { WidgetFrame } from "./widget-frame";
import { DriftCard } from "./drift-card";
import { ResultIssuesBanner } from "./result-issues-banner";
import { buildJsonView, findActiveWidget } from "./step-views";
import { CopyButton } from "@/components/ui/copy-button";
import { validateToolResult } from "@/lib/studio/validate-tool-result";
import type { Drift, Matcher, Step } from "../types";

interface Props {
  steps: readonly Step[];
  selectedStepIdx: number;
  drifts: readonly Drift[];
  /** Drift index inside `drifts` that should be scrolled into view + pulsed.
   *  Reset to null after the scroll completes. */
  scrollToDriftIdx?: number | null;
  showIgnored: boolean;
  onIgnorePath?: (path: string) => void;
  onMatchPath?: (path: string, matcher: Matcher) => void;
  /** Current compare mode for this step (read from the recorded trace). */
  compareMode?: "exact" | "shape";
  /** Switch this step's compare strategy. Caller persists + re-diffs. */
  onCompareChange?: (mode: "exact" | "shape") => void | Promise<void>;
}

const SHAPE_BANNER_THRESHOLD = 5;

export function StepDetail({
  steps,
  selectedStepIdx,
  drifts,
  scrollToDriftIdx,
  showIgnored,
  onIgnorePath,
  onMatchPath,
  compareMode = "exact",
  onCompareChange,
}: Props) {
  const widget = useMemo(
    () => findActiveWidget(steps, selectedStepIdx),
    [steps, selectedStepIdx],
  );
  const jsonView = useMemo(
    () => buildJsonView(steps, selectedStepIdx),
    [steps, selectedStepIdx],
  );
  // Surface spec-compliance issues on the recorded response so review
  // sessions catch the same footguns (e.g. non-object structuredContent)
  // that the live preview flags. Only meaningful for mcp.response steps.
  const resultIssues = useMemo(() => {
    const step = steps[Math.min(selectedStepIdx, steps.length - 1)];
    const a = step?.action;
    if (a?.driver !== "mcp" || a.kind !== "response") return [];
    return validateToolResult(a.payload.result);
  }, [steps, selectedStepIdx]);
  const visibleDrifts = useMemo(
    () =>
      drifts.filter(
        (d) =>
          showIgnored ||
          !d.suppressedBy ||
          !d.suppressedBy.layer.endsWith(".ignore"),
      ),
    [drifts, showIgnored],
  );

  const driftRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (scrollToDriftIdx == null) return;
    const el = driftRefs.current[scrollToDriftIdx];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToDriftIdx]);

  const showDrifts = visibleDrifts.length > 0;
  const showJson = !!jsonView;
  const showWidget = !!widget;
  const failDriftCount = visibleDrifts.filter(
    (d) => d.severity === "fail" && !d.suppressedBy,
  ).length;
  const showShapeBanner =
    onCompareChange &&
    compareMode === "exact" &&
    failDriftCount >= SHAPE_BANNER_THRESHOLD;

  const hasIssues = resultIssues.length > 0;

  if (
    !showDrifts &&
    !showJson &&
    !showWidget &&
    !onCompareChange &&
    !hasIssues
  ) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-xs font-mono text-muted-foreground italic">
          Nothing to show for this step.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ResultIssuesBanner issues={resultIssues} />
        {showDrifts && (
          <section className="border-b">
            <SectionHeader
              title={`Drifts (${visibleDrifts.length})`}
              right={
                drifts.length > visibleDrifts.length
                  ? `${drifts.length - visibleDrifts.length} ignored`
                  : undefined
              }
              compareMode={onCompareChange ? compareMode : undefined}
              onCompareChange={onCompareChange}
            />
            {showShapeBanner && (
              <div className="mx-3 mt-3 rounded-md border border-yellow-400/40 bg-yellow-400/10 px-3 py-2 flex items-center gap-3">
                <span className="text-[11px] text-yellow-200/90 flex-1">
                  {failDriftCount} value drifts on this step. If the response
                  content varies across envs, switch to shape-only to assert
                  structure instead of values.
                </span>
                <button
                  type="button"
                  onClick={() => onCompareChange?.("shape")}
                  className="text-[11px] px-2 py-0.5 rounded border border-yellow-400/60 text-yellow-100 hover:bg-yellow-400/20 transition-colors shrink-0"
                >
                  Switch to shape-only
                </button>
              </div>
            )}
            <div className="p-3 space-y-2">
              {visibleDrifts.map((drift, i) => (
                <DriftCard
                  key={`${drift.path}-${i}`}
                  ref={(el) => {
                    driftRefs.current[i] = el;
                  }}
                  drift={drift}
                  isHighlighted={i === scrollToDriftIdx}
                  onIgnorePath={onIgnorePath}
                  onMatchPath={onMatchPath}
                />
              ))}
            </div>
          </section>
        )}

        {showWidget && (
          <section className={showJson ? "border-b" : undefined}>
            <SectionHeader
              title={widget!.uri}
              action={
                <CopyButton value={() => widget!.html} label="Copy HTML" />
              }
            />
            <div className="flex">
              <div className="flex-1 min-w-0 min-h-[320px] bg-background">
                <WidgetFrame
                  key={`${selectedStepIdx}-${widget!.uri}`}
                  html={widget!.html}
                  mock={widget!.mock}
                  platform="openai"
                  strict={false}
                  viewOnly
                  className="border-none block w-full"
                  style={{ minHeight: "320px", width: "100%" }}
                />
              </div>
              <aside className="w-72 shrink-0 border-l overflow-y-auto bg-secondary/30">
                <CspFindingsList findings={widget!.findings} />
              </aside>
            </div>
          </section>
        )}

        {showJson && (
          <section>
            <SectionHeader
              title={jsonView!.label}
              right={jsonView!.subtitle}
              action={
                <CopyButton value={() => jsonView!.body} label="Copy JSON" />
              }
            />
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all bg-background text-foreground select-text">
              {jsonView!.body}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  right,
  compareMode,
  onCompareChange,
  action,
}: {
  title: string;
  right?: string;
  compareMode?: "exact" | "shape";
  onCompareChange?: (mode: "exact" | "shape") => void | Promise<void>;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2 border-b bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 truncate flex items-center justify-between gap-2">
      <span className="truncate">{title}</span>
      <div className="flex items-center gap-3 shrink-0">
        {right && (
          <span className="text-muted-foreground/60 normal-case tracking-normal">
            {right}
          </span>
        )}
        {onCompareChange && compareMode && (
          <label className="flex items-center gap-1 normal-case tracking-normal">
            <span className="text-muted-foreground/60">Compare:</span>
            <select
              value={compareMode}
              onChange={(e) =>
                onCompareChange(e.target.value as "exact" | "shape")
              }
              className="bg-transparent border border-border/60 rounded px-1 py-0.5 text-[10px] text-foreground"
            >
              <option value="exact">Exact</option>
              <option value="shape">Shape only</option>
            </select>
          </label>
        )}
        {action}
      </div>
    </div>
  );
}
