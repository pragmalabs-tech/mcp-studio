/**
 * Pairwise diff of two Traces' Step.stateAfter values. Walks each step's
 * stateAfter pair and emits one Drift per disagreeing leaf, named by
 * dot-path. Rules suppress or reshape what would otherwise count:
 *   match  — replaces exact-equality with a shape/format assertion.
 *            A passing matcher emits `severity: "warn"` (yellow in the
 *            UI) with `suppressedBy: *.match` for explainability; a
 *            failing matcher emits an unsuppressed fail drift.
 *   ignore — silently drops the disagreement (`suppressedBy: *.ignore`).
 *
 * Fail drifts (no rule matched) are run through the auto-classifier to
 * attach a `classification` hint when both sides share a known shape
 * (datetime/UUID/secret/...). The classifier never auto-applies the
 * suggestion; UI surfaces it as a banner with an "Apply" affordance.
 *
 * `Verdict.ok` is `true` iff every fail drift carries `suppressedBy`.
 * Suppressed drifts are returned so the UI can explain what was let
 * through; `warn` drifts also pass.
 */

import { classify } from "./classify";
import { checkMatcher, findIgnore, findMatch } from "./rules";
import type {
  Drift,
  DriftReason,
  ResolvedRules,
  Trace,
  Verdict,
} from "./types";

export function diff(
  recorded: Trace,
  replayed: Trace,
  rules: ResolvedRules,
): Verdict {
  const drifts: Drift[] = [];
  const n = Math.max(recorded.steps.length, replayed.steps.length);

  for (let i = 0; i < n; i++) {
    const rec = recorded.steps[i];
    const rep = replayed.steps[i];
    if (!rec) {
      drifts.push(d(i, "", undefined, rep.action, "step_extra"));
      continue;
    }
    if (!rep) {
      drifts.push(d(i, "", rec.action, undefined, "step_missing"));
      continue;
    }
    if (rec.stateAfter === rep.stateAfter) continue;
    // Drift is reported AT THE STEP WHERE IT AROSE. If neither side
    // changed a cell since the previous step, the drift (if any) was
    // already reported there — skip to avoid noise. `prevRec`/`prevRep`
    // are the previous step's stateAfter on each side (or initialState
    // at step 0).
    const prevRec =
      i === 0 ? recorded.initialState : recorded.steps[i - 1].stateAfter;
    const prevRep =
      i === 0 ? replayed.initialState : replayed.steps[i - 1].stateAfter;
    walk(
      rec.stateAfter,
      rep.stateAfter,
      prevRec,
      prevRep,
      "",
      i,
      rules,
      drifts,
    );
  }

  drifts.sort(
    (a, b) => a.stepIndex - b.stepIndex || a.path.localeCompare(b.path),
  );
  return { ok: drifts.every(isSurfacedOk), drifts };
}

function isSurfacedOk(drift: Drift): boolean {
  return drift.severity !== "fail" || drift.suppressedBy !== undefined;
}

function walk(
  exp: unknown,
  act: unknown,
  prevExp: unknown,
  prevAct: unknown,
  path: string,
  stepIndex: number,
  rules: ResolvedRules,
  out: Drift[],
): void {
  // Identity short-circuit: this cell didn't move on either side since
  // the previous step. Whatever drift exists here was already reported
  // (or didn't exist at all). Don't re-report.
  if (exp === prevExp && act === prevAct) return;
  if (!sameShape(exp, act)) {
    out.push(applyRules(d(stepIndex, path, exp, act, "type_differs"), rules));
    return;
  }
  if (exp === null || typeof exp !== "object") {
    if (exp !== act) {
      // Leaf: try match first (shape check; pass → warn+suppressedBy,
      // fail → red drift); then fall through to ignore + classifier.
      const matchEntry = findMatch(path, rules.match);
      if (matchEntry) {
        const passed =
          checkMatcher(matchEntry.matcher, exp) &&
          checkMatcher(matchEntry.matcher, act);
        const drift = d(stepIndex, path, exp, act, "value_differs");
        if (passed) {
          drift.severity = "warn";
          drift.suppressedBy = {
            layer: matchEntry.layer,
            pattern: matchEntry.pattern,
          };
        }
        out.push(drift);
        return;
      }
      out.push(
        applyRules(d(stepIndex, path, exp, act, "value_differs"), rules),
      );
    }
    return;
  }
  if (Array.isArray(exp)) {
    const a = exp as unknown[];
    const b = act as unknown[];
    const pa = Array.isArray(prevExp) ? (prevExp as unknown[]) : [];
    const pb = Array.isArray(prevAct) ? (prevAct as unknown[]) : [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const cp = `${path}[${i}]`;
      if (i >= a.length) {
        out.push(applyRules(d(stepIndex, cp, undefined, b[i], "extra"), rules));
      } else if (i >= b.length) {
        out.push(
          applyRules(d(stepIndex, cp, a[i], undefined, "missing"), rules),
        );
      } else {
        walk(a[i], b[i], pa[i], pb[i], cp, stepIndex, rules, out);
      }
    }
    return;
  }
  const eo = exp as Record<string, unknown>;
  const ao = act as Record<string, unknown>;
  const peo = isPlainObject(prevExp) ? prevExp : {};
  const pao = isPlainObject(prevAct) ? prevAct : {};
  const keys = sortedUnion(Object.keys(eo), Object.keys(ao));
  for (const k of keys) {
    const cp = path ? `${path}.${k}` : k;
    const inE = Object.prototype.hasOwnProperty.call(eo, k);
    const inA = Object.prototype.hasOwnProperty.call(ao, k);
    if (!inA) {
      out.push(
        applyRules(d(stepIndex, cp, eo[k], undefined, "missing"), rules),
      );
    } else if (!inE) {
      out.push(applyRules(d(stepIndex, cp, undefined, ao[k], "extra"), rules));
    } else {
      walk(eo[k], ao[k], peo[k], pao[k], cp, stepIndex, rules, out);
    }
  }
}

/** Stamp `suppressedBy` from a matching `ignore` pattern; otherwise run
 *  the auto-classifier on `value_differs` drifts so the UI can surface
 *  a suggestion. Returns the same drift either way for chaining. */
function applyRules(drift: Drift, rules: ResolvedRules): Drift {
  const hit = findIgnore(drift.path, rules.ignore);
  if (hit) {
    drift.suppressedBy = { layer: hit.layer, pattern: hit.pattern };
    return drift;
  }
  if (drift.reason === "value_differs") {
    const c = classify(drift.expected, drift.actual);
    if (c) drift.classification = c;
  }
  return drift;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function d(
  stepIndex: number,
  path: string,
  expected: unknown,
  actual: unknown,
  reason: DriftReason,
): Drift {
  return { stepIndex, path, expected, actual, reason, severity: "fail" };
}

function sameShape(a: unknown, b: unknown): boolean {
  return (
    typeof a === typeof b &&
    (a === null) === (b === null) &&
    Array.isArray(a) === Array.isArray(b)
  );
}

function sortedUnion(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const k of a) seen.add(k);
  for (const k of b) seen.add(k);
  return Array.from(seen).sort();
}
