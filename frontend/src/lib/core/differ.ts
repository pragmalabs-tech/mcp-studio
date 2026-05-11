/**
 * Pairwise diff of two Traces' Step.stateAfter values, ignoring volatile
 * paths. Produces a Verdict with structured Drifts named by dot-path.
 */

import { matchesAnyPattern } from "./util/path-match";
import type { Drift, DriftReason, Trace, Verdict } from "./types";

export function diff(
  recorded: Trace,
  replayed: Trace,
  volatilePaths: readonly string[],
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
      volatilePaths,
      drifts,
    );
  }

  drifts.sort(
    (a, b) => a.stepIndex - b.stepIndex || a.path.localeCompare(b.path),
  );
  return { ok: drifts.every((x) => x.severity !== "fail"), drifts };
}

function walk(
  exp: unknown,
  act: unknown,
  prevExp: unknown,
  prevAct: unknown,
  path: string,
  stepIndex: number,
  vol: readonly string[],
  out: Drift[],
): void {
  if (matchesAnyPattern(path, vol)) return;
  // Identity short-circuit: this cell didn't move on either side since
  // the previous step. Whatever drift exists here was already reported
  // (or didn't exist at all). Don't re-report.
  if (exp === prevExp && act === prevAct) return;
  if (!sameShape(exp, act)) {
    out.push(d(stepIndex, path, exp, act, "type_differs"));
    return;
  }
  if (exp === null || typeof exp !== "object") {
    if (exp !== act) out.push(d(stepIndex, path, exp, act, "value_differs"));
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
      if (i >= a.length) out.push(d(stepIndex, cp, undefined, b[i], "extra"));
      else if (i >= b.length)
        out.push(d(stepIndex, cp, a[i], undefined, "missing"));
      else walk(a[i], b[i], pa[i], pb[i], cp, stepIndex, vol, out);
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
      if (!matchesAnyPattern(cp, vol))
        out.push(d(stepIndex, cp, eo[k], undefined, "missing"));
    } else if (!inE) {
      if (!matchesAnyPattern(cp, vol))
        out.push(d(stepIndex, cp, undefined, ao[k], "extra"));
    } else {
      walk(eo[k], ao[k], peo[k], pao[k], cp, stepIndex, vol, out);
    }
  }
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
