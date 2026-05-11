/**
 * RulesEditor — review and edit the per-trace assertion rules.
 *
 * Three sections:
 *   - Built-in defaults (read-only) so the user can see what the
 *     differ already suppresses without any trace-level configuration.
 *   - Trace-level ignore + match rows (editable + removable).
 *   - "Test rule" form: enter a path + sample value, see whether the
 *     resolved rule set would suppress it (and which rule won).
 */

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { allVolatilePaths, builtinMatch } from "@/lib/core/registry";
import {
  addIgnore,
  checkMatcher,
  findIgnore,
  findMatch,
  removeRule,
  resolveRules,
  setMatch,
} from "@/lib/core/rules";
import type { Matcher, Trace, TraceRules } from "@/lib/core/types";

interface Props {
  trace: Trace;
  onChange(rules: TraceRules): void;
}

const MATCHER_LABELS: Array<{ value: Matcher; label: string }> = [
  { value: "@any", label: "@any" },
  { value: "@iso8601", label: "@iso8601" },
  { value: "@uuid", label: "@uuid" },
  { value: "@epoch", label: "@epoch" },
];

export function RulesEditor({ trace, onChange }: Props) {
  const rules: TraceRules = trace.rules ?? {};
  const builtinIgnore = useMemo(() => allVolatilePaths(), []);
  const builtinMatchEntries = useMemo(() => Object.entries(builtinMatch()), []);

  return (
    <div className="text-xs space-y-4 p-4">
      <Section title="Built-in (read-only)">
        <p className="text-[10px] text-muted-foreground mb-2">
          Driver-level defaults that always apply.
        </p>
        <div className="space-y-1">
          {builtinIgnore.map((p) => (
            <Row key={`bi-${p}`} label="ignore" path={p} muted />
          ))}
          {builtinMatchEntries.map(([p, m]) => (
            <Row
              key={`bm-${p}`}
              label="match"
              path={p}
              tail={matcherText(m)}
              muted
            />
          ))}
          {builtinIgnore.length === 0 && builtinMatchEntries.length === 0 && (
            <p className="text-muted-foreground italic">none</p>
          )}
        </div>
      </Section>

      <Section title="Trace rules">
        <p className="text-[10px] text-muted-foreground mb-2">
          Additive on top of built-ins. Persisted on this trace.
        </p>
        <div className="space-y-1">
          {(rules.ignore ?? []).map((p) => (
            <Row
              key={`ti-${p}`}
              label="ignore"
              path={p}
              onRemove={() => onChange(removeRule(rules, p))}
            />
          ))}
          {Object.entries(rules.match ?? {}).map(([p, m]) => (
            <Row
              key={`tm-${p}`}
              label="match"
              path={p}
              tail={matcherText(m)}
              onRemove={() => onChange(removeRule(rules, p))}
            />
          ))}
          {(rules.ignore?.length ?? 0) === 0 &&
            Object.keys(rules.match ?? {}).length === 0 && (
              <p className="text-muted-foreground italic">none</p>
            )}
        </div>
        <AddRuleForm rules={rules} onChange={onChange} />
      </Section>

      <Section title="Test rule">
        <RuleTester trace={trace} />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  path,
  tail,
  muted,
  onRemove,
}: {
  label: "ignore" | "match";
  path: string;
  tail?: string;
  muted?: boolean;
  onRemove?(): void;
}) {
  return (
    <div
      className={`flex items-center gap-2 font-mono text-[11px] ${
        muted ? "text-muted-foreground" : ""
      }`}
    >
      <span className="w-12 shrink-0 uppercase tracking-wider text-[9px] opacity-60">
        {label}
      </span>
      <code className="flex-1 truncate">{path}</code>
      {tail && <code className="text-[10px] opacity-80">{tail}</code>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-60 hover:opacity-100 hover:text-red-400"
          title="Remove rule"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function AddRuleForm({
  rules,
  onChange,
}: {
  rules: TraceRules;
  onChange(next: TraceRules): void;
}) {
  const [kind, setKind] = useState<"ignore" | "match">("ignore");
  const [path, setPath] = useState("");
  const [matcher, setMatcher] = useState<Matcher>("@any");
  const [regex, setRegex] = useState("");

  const submit = () => {
    if (!path.trim()) return;
    if (kind === "ignore") {
      onChange(addIgnore(rules, path.trim()));
    } else {
      const m: Matcher = matcher === "@any" && regex ? { regex } : matcher;
      onChange(setMatch(rules, path.trim(), m));
    }
    setPath("");
    setRegex("");
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as "ignore" | "match")}
        className="px-1.5 py-0.5 border rounded bg-background"
      >
        <option value="ignore">ignore</option>
        <option value="match">match</option>
      </select>
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="path.glob.with.*.wildcard"
        className="flex-1 min-w-[160px] px-2 py-0.5 border rounded bg-background font-mono"
      />
      {kind === "match" && (
        <>
          <select
            value={typeof matcher === "string" ? matcher : "regex"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "regex") setMatcher({ regex: regex || "" });
              else setMatcher(v as Matcher);
            }}
            className="px-1.5 py-0.5 border rounded bg-background"
          >
            {MATCHER_LABELS.map((m) => (
              <option key={m.label} value={m.value as string}>
                {m.label}
              </option>
            ))}
            <option value="regex">regex</option>
          </select>
          {typeof matcher === "object" && (
            <input
              type="text"
              value={regex}
              onChange={(e) => {
                setRegex(e.target.value);
                setMatcher({ regex: e.target.value });
              }}
              placeholder="regex pattern"
              className="flex-1 min-w-[120px] px-2 py-0.5 border rounded bg-background font-mono"
            />
          )}
        </>
      )}
      <Button size="sm" onClick={submit} disabled={!path.trim()}>
        Add
      </Button>
    </div>
  );
}

function RuleTester({ trace }: { trace: Trace }) {
  const [path, setPath] = useState("");
  const [sample, setSample] = useState("");
  const resolved = useMemo(() => resolveRules(trace), [trace]);

  const result = useMemo(() => {
    if (!path.trim()) return null;
    const m = findMatch(path.trim(), resolved.match);
    if (m) {
      let val: unknown = sample;
      try {
        val = JSON.parse(sample);
      } catch {
        /* keep as raw string */
      }
      const passed = checkMatcher(m.matcher, val);
      return {
        verdict: passed
          ? ("suppressed (match passed)" as const)
          : ("surfaced (match failed)" as const),
        layer: m.layer,
        pattern: m.pattern,
        matcher: matcherText(m.matcher),
      };
    }
    const i = findIgnore(path.trim(), resolved.ignore);
    if (i) {
      return {
        verdict: "suppressed (ignore)" as const,
        layer: i.layer,
        pattern: i.pattern,
      };
    }
    return { verdict: "surfaced (no rule)" as const };
  }, [path, sample, resolved]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="path to test (e.g. tools.weather.lastResult.id)"
        className="w-full px-2 py-1 border rounded bg-background font-mono text-[11px]"
      />
      <input
        type="text"
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        placeholder='sample value (JSON or raw, e.g. "2026-05-11T12:00:00Z")'
        className="w-full px-2 py-1 border rounded bg-background font-mono text-[11px]"
      />
      {result && (
        <div className="text-[11px] font-mono p-2 rounded bg-muted/40 space-y-0.5">
          <div>
            <span className="opacity-60">verdict:</span> {result.verdict}
          </div>
          {"layer" in result && (
            <div>
              <span className="opacity-60">winning rule:</span> {result.layer} ·{" "}
              <code>{result.pattern}</code>
              {"matcher" in result && result.matcher && (
                <>
                  {" "}
                  · <code>{result.matcher}</code>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function matcherText(m: Matcher): string {
  return typeof m === "string" ? m : `regex(${m.regex})`;
}
