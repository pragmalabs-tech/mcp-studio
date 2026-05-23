/**
 * Centralized status semantics. Anything in the studio that needs to render
 * a "passed / failed / running / pending" pill should look up its color +
 * label + icon here so the UI stays consistent.
 *
 * Add new statuses by extending `STATUS_META`. Components consuming this
 * (StatusBadge, dot indicators, etc.) read `tone` to pick the right Tailwind
 * token (success / destructive / warning / muted-foreground) so we never
 * hand-pick raw `bg-emerald-400` / `bg-red-400` colors at the call site.
 */

export type StatusTone =
  | "success"
  | "destructive"
  | "warning"
  | "neutral"
  | "info";

export type Status =
  | "passed"
  | "failed"
  | "running"
  | "pending"
  | "skipped"
  | "warning";

export interface StatusMeta {
  tone: StatusTone;
  label: string;
}

export const STATUS_META: Record<Status, StatusMeta> = {
  passed: { tone: "success", label: "Passed" },
  failed: { tone: "destructive", label: "Failed" },
  running: { tone: "info", label: "Running" },
  pending: { tone: "neutral", label: "Pending" },
  skipped: { tone: "neutral", label: "Skipped" },
  warning: { tone: "warning", label: "Warning" },
};

/** Background dot color (used for tiny status indicators in lists). */
export const TONE_DOT_BG: Record<StatusTone, string> = {
  success: "bg-success",
  destructive: "bg-destructive",
  warning: "bg-warning",
  neutral: "bg-muted-foreground",
  info: "bg-primary",
};

/** Foreground text color for the same tones. */
export const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
  neutral: "text-muted-foreground",
  info: "text-primary",
};
