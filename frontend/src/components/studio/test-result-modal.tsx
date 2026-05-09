import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  XIcon,
  Download,
  Save,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ReplayReport } from "@/lib/replay/report";
import { reportFilename } from "@/lib/replay/report";
import type { StepResult } from "@/lib/replay/player";
import { verbalize } from "@/lib/recorder/summarize";
import type { PreviewArtifact } from "@/lib/replay/artifacts";

interface Props {
  report: ReplayReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveToDisk: (report: ReplayReport) => Promise<void>;
}

function StatusIcon({ status }: { status: StepResult["status"] }) {
  if (status === "pass")
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (status === "fail" || status === "timeout")
    return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

/** What did the live system actually return for this step? */
function liveSummary(step: StepResult): string {
  const obs = step.observation as Record<string, unknown> | undefined;
  if (!obs) return "";
  // mcp.request: observation is the captured mcp.response entry from the bus
  if (step.action.kind === "mcp.request") {
    if (typeof obs.error === "object" && obs.error !== null) {
      const m = (obs.error as { message?: string }).message;
      return `→ error: ${m ?? "unknown"}`;
    }
    if ((obs as { skipped?: string }).skipped) {
      return `→ ${(obs as { skipped: string }).skipped}`;
    }
    if ("durationMs" in obs && typeof obs.durationMs === "number") {
      const result = (obs as { result?: unknown }).result;
      const size = result == null ? 0 : JSON.stringify(result).length;
      return `→ ok · ${size} chars · ${obs.durationMs.toFixed(0)}ms`;
    }
    return "→ ok";
  }
  // widget.render: observation is RenderCompleteResult
  if (step.action.kind === "widget.render") {
    const r = obs as {
      bodyChars?: number;
      hasRuntimeErrors?: boolean;
      handshakeOk?: boolean;
      renderDurationMs?: number;
    };
    const parts: string[] = [];
    if (typeof r.bodyChars === "number") parts.push(`${r.bodyChars} chars`);
    if (typeof r.renderDurationMs === "number")
      parts.push(`${r.renderDurationMs.toFixed(0)}ms`);
    if (r.hasRuntimeErrors) parts.push("⚠ runtime errors");
    if (r.handshakeOk === false) parts.push("⚠ no handshake");
    return parts.length ? `→ ${parts.join(" · ")}` : "";
  }
  // widget.dom.* : observation is bridge AckResult
  if (step.action.kind.startsWith("widget.dom.")) {
    const a = obs as { ok?: boolean; mutated?: boolean; reason?: string };
    if (a.ok === false) return `→ ack ko: ${a.reason ?? "no reason"}`;
    return `→ ack ok${a.mutated ? " · DOM mutated" : ""}`;
  }
  return "";
}

function WidgetPreview({ html }: { html: string }) {
  return (
    <iframe
      title="Widget render preview"
      sandbox=""
      srcDoc={html}
      className="w-full h-72 rounded border border-border/40 bg-white"
    />
  );
}

function StepRow({
  step,
  failure,
  preview,
}: {
  step: StepResult;
  failure?: { domSnapshot: string; errors: string[] };
  preview?: PreviewArtifact;
}) {
  const [open, setOpen] = useState(false);
  const expandable = true;
  const verb = verbalize(step.action);
  const live = liveSummary(step);
  const isFailure = step.status === "fail" || step.status === "timeout";
  const isSkip = step.status === "skip";

  return (
    <div className="text-xs font-mono border-b border-border/30 hover:bg-secondary/20">
      <div
        className={`px-3 py-1.5 flex items-center gap-2 ${expandable ? "cursor-pointer" : ""}`}
        onClick={() => expandable && setOpen((v) => !v)}
      >
        <span className="text-muted-foreground/60 w-10 shrink-0 text-right">
          {step.index + 1}
        </span>
        <StatusIcon status={step.status} />
        <span className="text-muted-foreground w-16 shrink-0 text-right">
          {step.durationMs.toFixed(0)}ms
        </span>
        <span className="text-foreground w-28 shrink-0 font-semibold truncate text-[10px] uppercase tracking-wider text-muted-foreground/80">
          {step.action.kind}
        </span>
        <span
          className={`truncate flex-1 ${
            isFailure
              ? "text-red-400"
              : isSkip
                ? "text-muted-foreground/70"
                : "text-foreground"
          }`}
          title={verb}
        >
          {verb}
          {live && <span className="ml-2 text-emerald-300/80">{live}</span>}
          {isFailure && step.reason && (
            <span className="ml-2 text-red-400">— {step.reason}</span>
          )}
        </span>
        <span className="text-muted-foreground/40 text-[10px] shrink-0">
          {open ? "▼" : "▶"}
        </span>
      </div>

      {open && (
        <div className="px-3 pb-3 ml-[5.5rem] space-y-3 border-t border-border/20 pt-2">
          {isSkip && step.reason && (
            <p className="text-[10px] text-muted-foreground italic">
              {step.reason}
            </p>
          )}
          {isFailure && step.reason && (
            <pre className="text-[10px] text-red-400 whitespace-pre-wrap bg-red-500/5 p-2 rounded border border-red-500/20">
              {step.reason}
            </pre>
          )}

          {preview && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                rendered preview ({preview.domSnapshot.length} chars)
              </div>
              <WidgetPreview html={preview.domSnapshot} />
            </div>
          )}

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              recorded action
            </div>
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 p-2 rounded">
              {JSON.stringify(step.action, null, 2)}
            </pre>
          </div>

          {!!step.observation && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                live observation
              </div>
              <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 p-2 rounded">
                {JSON.stringify(step.observation, null, 2)}
              </pre>
            </div>
          )}

          {failure && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-red-400">
                DOM at failure ({failure.domSnapshot.length} chars)
              </div>
              {failure.errors.length > 0 && (
                <pre className="text-[10px] text-red-400">
                  errors: {failure.errors.join(", ")}
                </pre>
              )}
              <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all max-h-64 overflow-auto bg-muted/30 p-2 rounded">
                {failure.domSnapshot.slice(0, 5000)}
                {failure.domSnapshot.length > 5000 ? "\n…(truncated)" : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TestResultModal({
  report,
  open,
  onOpenChange,
  onSaveToDisk,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  if (!report) return null;

  function handleExport() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportFilename(report)}.report.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveToDisk() {
    if (!report) return;
    setSaving(true);
    try {
      await onSaveToDisk(report);
      setSavedAs(reportFilename(report));
    } finally {
      setSaving(false);
    }
  }

  const { summary } = report;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-0 right-0 z-50 h-screen w-[720px] max-w-[95vw] bg-popover text-sm text-popover-foreground border-l shadow-2xl outline-none flex flex-col data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right duration-150"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 gap-2">
            <DialogPrimitive.Title className="text-sm font-medium flex items-center gap-2 min-w-0">
              <span className="truncate">{report.test.name}</span>
              <span className="text-xs font-normal text-muted-foreground">
                report
              </span>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveToDisk}
                disabled={saving}
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Saving…" : savedAs ? "Saved" : "Save to disk"}
              </Button>
              <DialogPrimitive.Close
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="px-4 py-2 border-b text-xs flex items-center gap-3 shrink-0">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {summary.passed} pass
            </span>
            <span className="inline-flex items-center gap-1 text-red-400">
              <XCircle className="h-3.5 w-3.5" />
              {summary.failed} fail
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MinusCircle className="h-3.5 w-3.5" />
              {summary.skipped} skip
            </span>
            <span className="text-muted-foreground font-mono">
              · {summary.total} total · {report.durationMs.toFixed(0)}ms
            </span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {report.steps.map((s) => (
              <StepRow
                key={s.index}
                step={s}
                failure={report.artifacts.failures[s.index]}
                preview={report.artifacts.previews?.[s.index]}
              />
            ))}
          </div>
          {savedAs && (
            <div className="px-4 py-2 border-t text-[10px] text-muted-foreground font-mono">
              saved as {savedAs}.json in ~/.mcp-studio/reports/
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
