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
import { buildJsonView, findActiveWidget } from "./step-views";
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
}

export function StepDetail({
  steps,
  selectedStepIdx,
  drifts,
  scrollToDriftIdx,
  showIgnored,
  onIgnorePath,
  onMatchPath,
}: Props) {
  const widget = useMemo(
    () => findActiveWidget(steps, selectedStepIdx),
    [steps, selectedStepIdx],
  );
  const jsonView = useMemo(
    () => buildJsonView(steps, selectedStepIdx),
    [steps, selectedStepIdx],
  );
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

  if (!showDrifts && !showJson && !showWidget) {
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
        {showDrifts && (
          <section className="border-b">
            <SectionHeader
              title={`Drifts (${visibleDrifts.length})`}
              right={
                drifts.length > visibleDrifts.length
                  ? `${drifts.length - visibleDrifts.length} ignored`
                  : undefined
              }
            />
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

        {showJson && (
          <section className={showWidget ? "border-b" : undefined}>
            <SectionHeader title={jsonView!.label} right={jsonView!.subtitle} />
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all bg-background text-foreground select-text">
              {jsonView!.body}
            </pre>
          </section>
        )}

        {showWidget && (
          <section>
            <SectionHeader title={widget!.uri} />
            <div className="flex">
              <div className="flex-1 min-w-0 min-h-[320px] bg-background">
                <WidgetFrame
                  key={`${selectedStepIdx}-${widget!.uri}`}
                  html={widget!.html}
                  mock={widget!.mock}
                  platform="openai"
                  strict={false}
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
      </div>
    </div>
  );
}

function SectionHeader({ title, right }: { title: string; right?: string }) {
  return (
    <div className="px-4 py-2 border-b bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 truncate flex items-center justify-between gap-2">
      <span className="truncate">{title}</span>
      {right && (
        <span className="text-muted-foreground/60 normal-case tracking-normal">
          {right}
        </span>
      )}
    </div>
  );
}

/** Header utility for higher-level layouts (re-exported so callers
 *  can match styling without importing it from this file).
 *  Kept here for now; move if other surfaces need it. */
export { SectionHeader as StepDetailSectionHeader };

// Re-export for downstream consumers (e.g. tests-page may want to
// surface a "Drifts toggle" widget eventually). Currently unused.
export type { Props as StepDetailProps };

/** Convenience: count surfaced (non-ignored) drifts for a step. */
export function surfacedCount(drifts: readonly Drift[]): number {
  return drifts.filter(
    (d) => !d.suppressedBy || !d.suppressedBy.layer.endsWith(".ignore"),
  ).length;
}
