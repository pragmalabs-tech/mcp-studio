/**
 * Inline banner showing spec-compliance issues from a tool/resource
 * response (e.g. structuredContent shape violation). Renders nothing
 * when there are no issues, so callers can mount it unconditionally.
 */

import type { ResultIssue } from "@/lib/studio/validate-tool-result";

export function ResultIssuesBanner({ issues }: { issues: ResultIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-red-500/30 bg-red-500/10">
      {issues.map((issue, i) => {
        const isError = issue.severity === "error";
        return (
          <div
            key={`${issue.code}-${i}`}
            className={`px-3 py-2 text-[11px] ${
              i > 0 ? "border-t border-red-500/20" : ""
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`shrink-0 font-bold ${
                  isError ? "text-red-400" : "text-yellow-400"
                }`}
              >
                {isError ? "✕" : "!"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-foreground">
                  {issue.title}
                </div>
                <div className="text-muted-foreground leading-snug mt-0.5">
                  {issue.detail}
                </div>
                {issue.fix && (
                  <div className="text-green-400/90 leading-snug mt-1 font-mono text-[10px] whitespace-pre-wrap">
                    Fix: {issue.fix}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
