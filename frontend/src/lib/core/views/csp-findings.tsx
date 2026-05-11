/**
 * Renders a CSP findings list with severity icons, error/warning grouping,
 * and a count-aware header. Shared by ContentDialog and TraceModal so both
 * surfaces present analyze() output identically.
 */

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { CspFinding } from "@/lib/core/csp/types";

export interface CspFindingsListProps {
  findings: readonly CspFinding[];
  /** Optional header label shown above the count. Default: "CSP findings". */
  label?: string;
  className?: string;
}

export function CspFindingsList({
  findings,
  label = "CSP findings",
  className,
}: CspFindingsListProps) {
  const sorted = useMemo(() => {
    // Errors first, then warnings; within each group preserve original order.
    return [...findings].sort((a, b) => severityRank(a) - severityRank(b));
  }, [findings]);

  const counts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const f of findings) {
      if (f.severity === "error") errors += 1;
      else warnings += 1;
    }
    return { errors, warnings };
  }, [findings]);

  if (findings.length === 0) {
    return (
      <div
        className={`px-3 py-4 text-[11px] flex items-center gap-2 ${
          className ?? ""
        }`}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span className="text-muted-foreground">
          No CSP issues detected in this widget.
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider sticky top-0 bg-secondary/40 backdrop-blur-sm flex items-center gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
          {counts.errors > 0 && (
            <span className="flex items-center gap-1 text-red-400 font-semibold">
              <XCircle className="h-3 w-3" />
              {counts.errors}
            </span>
          )}
          {counts.warnings > 0 && (
            <span className="flex items-center gap-1 text-yellow-400 font-semibold">
              <AlertTriangle className="h-3 w-3" />
              {counts.warnings}
            </span>
          )}
        </span>
      </div>
      <ul className="divide-y divide-border/40">
        {sorted.map((f, i) => (
          <FindingRow key={i} finding={f} />
        ))}
      </ul>
    </div>
  );
}

function FindingRow({ finding }: { finding: CspFinding }) {
  const [open, setOpen] = useState(false);
  const isError = finding.severity === "error";
  const Icon = isError ? XCircle : AlertTriangle;
  const tone = isError ? "text-red-400" : "text-yellow-400";
  const bg = isError ? "bg-red-500/5" : "bg-yellow-500/5";

  return (
    <li className={`text-xs font-mono ${bg}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-muted/30 cursor-pointer"
      >
        <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${tone}`} />
        <div className="flex-1 min-w-0">
          <div className={`font-semibold ${tone}`}>{finding.directive}</div>
          <div className="text-muted-foreground break-all mt-0.5">
            {finding.blocked}
          </div>
          {finding.line > 0 && (
            <div className="text-muted-foreground/60 text-[10px] mt-0.5">
              line {finding.line}
            </div>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-2 pl-9 text-[11px] space-y-1.5">
          <div className="text-muted-foreground">{finding.description}</div>
          {finding.fix && (
            <div className="text-green-400/80 whitespace-pre-line">
              {finding.fix}
            </div>
          )}
          {finding.snippet && (
            <pre className="mt-1.5 p-2 rounded bg-secondary/50 text-[10px] leading-relaxed overflow-x-auto">
              {finding.snippet.lines.map((line, i) => {
                const isHit = i === finding.snippet!.highlightIdx;
                return (
                  <div
                    key={i}
                    className={
                      isHit
                        ? "bg-red-500/10 text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    <span className="select-none text-muted-foreground/50 pr-2 inline-block w-10 text-right">
                      {isHit ? "→ " : "  "}
                      {line.num}
                    </span>
                    {line.text || " "}
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

function severityRank(f: CspFinding): number {
  return f.severity === "error" ? 0 : 1;
}
