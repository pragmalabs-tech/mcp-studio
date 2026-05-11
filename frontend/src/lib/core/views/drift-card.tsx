/**
 * Single drift card for the right-pane Drifts section. Renders
 * expected/got at full pane width (no inner scrolling on typical JSON
 * payloads), inline rule actions, and — when the classifier hit — a
 * yellow suggestion banner with one-click acceptance.
 *
 * Severity color matrix (single source of truth):
 *   fail + no suppressedBy + no classification → red
 *   fail + no suppressedBy + classification.kind != sensitive → yellow
 *   fail + no suppressedBy + classification.sensitive          → yellow + shield
 *   warn + suppressedBy.match                                  → yellow ("passed")
 *   fail + suppressedBy.ignore                                  → gray (hidden by default)
 */

import { forwardRef, useState } from "react";
import { Shield } from "lucide-react";
import type { Classification, Drift, Matcher, SuggestedRule } from "../types";
import { generalizePath } from "./step-views";

interface Props {
  drift: Drift;
  isHighlighted?: boolean;
  onIgnorePath?: (path: string) => void;
  onMatchPath?: (path: string, matcher: Matcher) => void;
}

type Tier =
  | "red"
  | "yellow-classified"
  | "yellow-sensitive"
  | "yellow-warn"
  | "gray";

function tierOf(drift: Drift): Tier {
  if (drift.severity === "warn") return "yellow-warn";
  if (drift.suppressedBy) return "gray";
  if (drift.classification?.sensitive) return "yellow-sensitive";
  if (drift.classification) return "yellow-classified";
  return "red";
}

const TIER_CLASS: Record<Tier, string> = {
  red: "border-red-400/50 bg-red-500/10",
  "yellow-classified": "border-yellow-400/50 bg-yellow-500/10",
  "yellow-sensitive": "border-yellow-500/60 bg-yellow-500/15",
  "yellow-warn": "border-yellow-400/40 bg-yellow-500/5",
  gray: "border-muted-foreground/30 bg-muted/30 text-muted-foreground/80",
};

const TIER_REASON_CLASS: Record<Tier, string> = {
  red: "text-red-400",
  "yellow-classified": "text-yellow-400",
  "yellow-sensitive": "text-yellow-500",
  "yellow-warn": "text-yellow-400",
  gray: "text-muted-foreground",
};

export const DriftCard = forwardRef<HTMLDivElement, Props>(function DriftCard(
  { drift, isHighlighted, onIgnorePath, onMatchPath },
  ref,
) {
  const tier = tierOf(drift);
  const surfaced = !drift.suppressedBy;
  const sensitive = !!drift.classification?.sensitive;
  const editable =
    drift.path !== "" && (onIgnorePath || onMatchPath) && surfaced;
  return (
    <div
      ref={ref}
      className={`text-xs font-mono border-l-4 px-3 py-2 rounded-sm ${TIER_CLASS[tier]} ${
        isHighlighted ? "ring-2 ring-primary/60" : ""
      } transition-all`}
    >
      <div className={`flex items-start gap-2 ${TIER_REASON_CLASS[tier]}`}>
        {sensitive && (
          <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="opacity-60 text-[10px] uppercase tracking-wider">
              {drift.reason}
            </span>
            <span className="font-semibold break-all">
              {drift.path || "(step)"}
            </span>
          </div>
          {drift.suppressedBy && (
            <div className="mt-0.5 text-[10px] opacity-70">
              {drift.severity === "warn" ? "passed " : "suppressed by "}
              <code>{drift.suppressedBy.layer}</code> ·{" "}
              <code>{drift.suppressedBy.pattern}</code>
              {drift.severity === "warn" && " — values differ"}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 text-[11px]">
        <span className="opacity-60 pt-0.5">expected:</span>
        <ValueBlock value={drift.expected} masked={sensitive} />
        <span className="opacity-60 pt-0.5">got:</span>
        <ValueBlock value={drift.actual} masked={sensitive} />
      </div>

      {drift.classification && surfaced && (
        <SuggestionBanner
          classification={drift.classification}
          driftPath={drift.path}
          onIgnorePath={onIgnorePath}
          onMatchPath={onMatchPath}
        />
      )}

      {editable && (
        <DriftActions
          path={drift.path}
          onIgnorePath={onIgnorePath}
          onMatchPath={onMatchPath}
        />
      )}
    </div>
  );
});

function ValueBlock({ value, masked }: { value: unknown; masked: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const display = masked && !revealed ? mask(value) : fmt(value);
  return (
    <div className="text-foreground/90 whitespace-pre-wrap break-all font-mono">
      {display}
      {masked && (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="ml-2 text-[10px] uppercase tracking-wider opacity-60 hover:opacity-100 underline"
        >
          {revealed ? "hide" : "reveal"}
        </button>
      )}
    </div>
  );
}

const MATCHER_OPTIONS: Array<{ label: string; matcher: Matcher }> = [
  { label: "@iso8601", matcher: "@iso8601" },
  { label: "@uuid", matcher: "@uuid" },
  { label: "@epoch", matcher: "@epoch" },
  { label: "@any", matcher: "@any" },
];

function DriftActions({
  path,
  onIgnorePath,
  onMatchPath,
}: {
  path: string;
  onIgnorePath?: (path: string) => void;
  onMatchPath?: (path: string, matcher: Matcher) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const generalized = generalizePath(path);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
      <span className="opacity-50">add rule:</span>
      {onIgnorePath && (
        <>
          <button
            type="button"
            onClick={() => onIgnorePath(path)}
            className="px-2 py-0.5 rounded border border-muted-foreground/30 hover:bg-muted/50"
            title={`Ignore exact path: ${path}`}
          >
            ignore exact
          </button>
          {generalized !== path && (
            <button
              type="button"
              onClick={() => onIgnorePath(generalized)}
              className="px-2 py-0.5 rounded border border-muted-foreground/30 hover:bg-muted/50"
              title={`Ignore for all tools: ${generalized}`}
            >
              ignore <code className="text-foreground/80">{generalized}</code>
            </button>
          )}
        </>
      )}
      {onMatchPath && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="px-2 py-0.5 rounded border border-muted-foreground/30 hover:bg-muted/50"
            title="Assert shape instead of equality"
          >
            match as…
          </button>
          {pickerOpen && (
            <div className="absolute z-10 mt-1 bg-popover border rounded shadow-md p-1 flex flex-col min-w-[120px]">
              {MATCHER_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    onMatchPath(generalized, opt.matcher);
                    setPickerOpen(false);
                  }}
                  className="text-left px-2 py-1 hover:bg-muted/50 rounded text-[11px]"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionBanner({
  classification,
  driftPath,
  onIgnorePath,
  onMatchPath,
}: {
  classification: Classification;
  driftPath: string;
  onIgnorePath?: (path: string) => void;
  onMatchPath?: (path: string, matcher: Matcher) => void;
}) {
  const generalized = generalizePath(driftPath);
  const apply = () => applySuggestion(classification.suggested, generalized);
  function applySuggestion(s: SuggestedRule, p: string) {
    if ("ignore" in s) onIgnorePath?.(p);
    else onMatchPath?.(p, s.match);
  }
  const label = describeSuggestion(classification);
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] px-2 py-1 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-200">
      <div className="flex-1 min-w-0">
        <span className="font-semibold uppercase tracking-wider opacity-80">
          {classification.sensitive ? "sensitive" : "suggestion"}
        </span>{" "}
        — {label} <code className="opacity-80 break-all">{generalized}</code>
      </div>
      {(onIgnorePath || onMatchPath) && (
        <button
          type="button"
          onClick={apply}
          className="shrink-0 px-2 py-0.5 rounded border border-yellow-500/50 hover:bg-yellow-500/20"
        >
          Apply
        </button>
      )}
    </div>
  );
}

function describeSuggestion(c: Classification): string {
  if ("match" in c.suggested) {
    return `looks like ${c.kind} — match as ${c.suggested.match}`;
  }
  return `${c.kind} detected — ignore`;
}

function mask(value: unknown): string {
  const s = typeof value === "string" ? value : fmt(value);
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(Math.max(4, s.length - 8))}${s.slice(-4)}`;
}

function fmt(v: unknown): string {
  if (v === undefined) return "-";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
