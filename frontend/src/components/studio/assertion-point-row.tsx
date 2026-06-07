import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-badge";
import { JsonView } from "@/components/ui/json-view";
import { cn } from "@/lib/utils";
import type { AssertablePoint, Mode, PointFailure } from "@/lib/assertion";

/**
 * One row per assertable point. Used in both the replay-result dialog
 * (Surface A) and the test detail view (Surface B). Always carries the
 * expected/actual pair so the diff can be inspected on demand — even on
 * passed points where the user just wants to see what was compared.
 *
 * The mode dropdown lists only `point.supportedModes`. Mode changes are
 * delegated upward via `onModeChange` — the row never writes to storage
 * itself so it can be hosted in any container that owns its own config.
 */
export interface AssertionPointRowProps {
  point: AssertablePoint;
  mode: Mode;
  /** Recorded value extracted at `point.path`. Shown when row is expanded. */
  expected: unknown;
  /** Live value extracted at `point.path`. Shown when row is expanded. */
  actual: unknown;
  /** Provided when this point failed verification. Defaults the row to expanded. */
  failure?: PointFailure;
  /** Provided when this point mismatched in "warn" mode (non-fatal). Defaults the row to expanded. */
  warning?: PointFailure;
  /** True when verifyAction reported `skipped` (no recorded baseline). */
  skipped?: boolean;
  onModeChange: (mode: Mode) => void;
}

const MODE_TOOLTIP: Record<Mode, string> = {
  exact: "Deep equal. Values must match exactly.",
  shape: "Same structure (keys + types). Values may differ.",
  flaky:
    "Deep equal, but skip uuids, iso-dates, jwts, epoch-ms. Scalar arrays are order-insensitive.",
  ignore: "Skip this point entirely; always passes.",
  warn: "Compare values but never fail. Mismatch shows as a warning.",
};

export function AssertionPointRow({
  point,
  mode,
  expected,
  actual,
  failure,
  warning,
  skipped,
  onModeChange,
}: AssertionPointRowProps) {
  const failed = !!failure;
  const warned = !failed && !!warning;
  const status = failed
    ? "failed"
    : warned
      ? "warning"
      : skipped || mode === "ignore"
        ? "skipped"
        : "passed";
  // Failures and warnings default to expanded; passing/ignored rows collapse to stay
  // scannable but can still be toggled to inspect values.
  const [expanded, setExpanded] = useState(failed || warned);
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  const hasDiff = expected !== undefined || actual !== undefined;

  return (
    <div
      className={cn(
        "rounded border",
        failed
          ? "border-destructive/30 bg-destructive/5"
          : warned
            ? "border-warning/30 bg-warning/5"
            : "border-border bg-background/40",
      )}
    >
      {/* Header is a plain row of siblings (NOT a single <button>) so the
          mode <Select> remains independently clickable. */}
      <div className="p-2 flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => hasDiff && setExpanded((v) => !v)}
          disabled={!hasDiff}
          className={cn(
            "flex items-center gap-2 flex-1 min-w-0 text-left rounded-sm",
            hasDiff
              ? "cursor-pointer hover:bg-foreground/[0.04]"
              : "cursor-default",
          )}
        >
          <Chevron
            className={cn(
              "size-3 shrink-0",
              hasDiff ? "text-muted-foreground" : "opacity-0",
            )}
          />
          <StatusDot status={status} />
          <span className="text-xs font-medium truncate">{point.label}</span>
          <code className="text-[10px] font-mono text-muted-foreground truncate">
            {point.key}
          </code>
          <span className="flex-1" />
          {failed ? (
            <span className="text-[11px] text-destructive truncate max-w-[40%]">
              {failure.reason}
            </span>
          ) : warned ? (
            <span className="text-[11px] text-warning truncate max-w-[40%]">
              {warning.reason}
            </span>
          ) : null}
        </button>
        <Select value={mode} onValueChange={(v) => onModeChange(v as Mode)}>
          <SelectTrigger size="sm" className="w-[96px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {point.supportedModes.map((m) => (
              <SelectItem key={m} value={m} title={MODE_TOOLTIP[m]}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {expanded && hasDiff ? (
        <div className="px-2 pb-2 grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Expected
            </div>
            <JsonView
              value={expected}
              diffAgainst={failed || warned ? actual : undefined}
            />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Actual
            </div>
            <JsonView
              value={actual}
              diffAgainst={failed || warned ? expected : undefined}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
