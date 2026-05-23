import {
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  STATUS_META,
  TONE_DOT_BG,
  type Status,
  type StatusTone,
} from "@/lib/status";

interface StatusBadgeProps {
  status: Status;
  /** Override the label (rare — defaults to STATUS_META[status].label). */
  label?: string;
  /** Hide the leading icon for very tight spaces. */
  hideIcon?: boolean;
  className?: string;
}

const TONE_TO_VARIANT: Record<
  StatusTone,
  "success" | "destructive" | "warning" | "secondary" | "default"
> = {
  success: "success",
  destructive: "destructive",
  warning: "warning",
  neutral: "secondary",
  info: "default",
};

function ToneIcon({ status }: { status: Status }) {
  switch (status) {
    case "passed":
      return <CheckCircle2 className="h-3 w-3" />;
    case "failed":
      return <XCircle className="h-3 w-3" />;
    case "running":
      return <Loader2 className="h-3 w-3 animate-spin" />;
    case "pending":
      return <Circle className="h-3 w-3" />;
    case "skipped":
      return <MinusCircle className="h-3 w-3" />;
    case "warning":
      return <Circle className="h-3 w-3" />;
  }
}

/**
 * Pass/fail/running pill driven entirely by `lib/status` semantics. Pick
 * this whenever you'd otherwise reach for a raw colored Badge — it keeps
 * the icon + color + label in one place so changing "passed" globally is
 * a one-line edit.
 */
export function StatusBadge({
  status,
  label,
  hideIcon = false,
  className,
}: StatusBadgeProps) {
  const meta = STATUS_META[status];
  const variant = TONE_TO_VARIANT[meta.tone];
  return (
    <Badge variant={variant} className={cn("gap-1", className)}>
      {!hideIcon && <ToneIcon status={status} />}
      {label ?? meta.label}
    </Badge>
  );
}

/** Tiny dot used in lists (e.g. step rows). Color comes from the same map. */
export function StatusDot({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const tone = STATUS_META[status].tone;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2 w-2 rounded-full shrink-0",
        TONE_DOT_BG[tone],
        className,
      )}
    />
  );
}
