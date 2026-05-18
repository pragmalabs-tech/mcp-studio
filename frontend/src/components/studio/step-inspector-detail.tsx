import { useMemo } from "react";
import type { Matcher, ResolvedRules, Step } from "@/lib/core/types";
import {
  actionInputs,
  actionLabel,
  actionExpectation,
} from "@/lib/core/action-format";
import { findIgnore, findMatch } from "@/lib/core/rules";
import {
  computeStateChanges,
  type StateChange,
} from "@/lib/core/state-changes";

interface Props {
  step: Step;
  prevStateAfter: unknown;
  resolvedRules: ResolvedRules;
}

export function StepInspectorDetail({
  step,
  prevStateAfter,
  resolvedRules,
}: Props) {
  const inputs = useMemo(() => actionInputs(step.action), [step.action]);
  const changes = useMemo(
    () => computeStateChanges(prevStateAfter, step.stateAfter),
    [prevStateAfter, step.stateAfter],
  );
  const expects = actionExpectation(step.action);

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold">
            {actionLabel(step.action)}
          </span>
          {step.compare === "shape" && (
            <span className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-yellow-400/15 text-yellow-200">
              shape
            </span>
          )}
        </div>
        {expects && (
          <p className="mt-1 text-[11px] text-muted-foreground font-mono">
            {expects}
          </p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <Section title="Inputs" empty="No input data for this action.">
          {inputs.length > 0 && (
            <dl className="space-y-2">
              {inputs.map((field) => (
                <div key={field.label}>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                    {field.label}
                  </dt>
                  <dd className="mt-1">
                    <ValueBlock value={field.value} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Section>

        <Section
          title="Step Expectation"
          subtitle="Replay must reproduce these state changes for this step to pass."
          empty="This step expects no state changes (likely an observation or no-op)."
        >
          {changes.length > 0 && (
            <ul className="space-y-1.5">
              {changes.map((c) => (
                <ChangeRow key={c.path} change={c} rules={resolvedRules} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasContent = !!children;
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {subtitle && (
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          {subtitle}
        </p>
      )}
      <div className="mt-2">
        {hasContent ? (
          children
        ) : (
          <p className="text-[11px] italic text-muted-foreground/70">{empty}</p>
        )}
      </div>
    </section>
  );
}

function ChangeRow({
  change,
  rules,
}: {
  change: StateChange;
  rules: ResolvedRules;
}) {
  const ignore = findIgnore(change.path, rules.ignore);
  const match = findMatch(change.path, rules.match);
  return (
    <li className="text-[11px] font-mono">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-foreground break-all">{change.path}</span>
        {ignore && (
          <span
            className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-muted text-muted-foreground"
            title={`ignored by ${ignore.layer} pattern ${ignore.pattern}`}
          >
            ignored
          </span>
        )}
        {!ignore && match && (
          <span
            className="text-[9px] uppercase tracking-wider px-1 py-0 rounded bg-yellow-400/15 text-yellow-200"
            title={`matched by ${match.layer} pattern ${match.pattern}`}
          >
            {matcherText(match.matcher)}
          </span>
        )}
      </div>
      <div className="ml-3 mt-0.5 grid grid-cols-[44px_1fr] gap-x-2 gap-y-0.5 text-[10px]">
        {change.before !== undefined && (
          <>
            <span className="text-muted-foreground/60">before</span>
            <span className="text-muted-foreground/80 break-all">
              {fmtInline(change.before)}
            </span>
          </>
        )}
        <span className="text-muted-foreground/60">after</span>
        <span className="text-foreground/90 break-all">
          {fmtInline(change.after)}
        </span>
      </div>
    </li>
  );
}

function ValueBlock({ value }: { value: unknown }) {
  if (value === undefined) {
    return (
      <span className="text-muted-foreground/60 italic text-[11px]">
        undefined
      </span>
    );
  }
  if (value === null) {
    return (
      <span className="text-muted-foreground/80 font-mono text-[11px]">
        null
      </span>
    );
  }
  if (typeof value !== "object") {
    return (
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all m-0 text-foreground/90">
        {String(value)}
      </pre>
    );
  }
  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all m-0 px-2 py-1.5 rounded bg-muted/40 text-foreground/90 max-h-80 overflow-y-auto">
      {safeStringify(value)}
    </pre>
  );
}

function fmtInline(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return safeStringify(v);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function matcherText(m: Matcher): string {
  return typeof m === "string" ? m : `regex(${m.regex})`;
}
