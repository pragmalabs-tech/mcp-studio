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
  Action,
  Drift,
  DriftReason,
  ResolvedRules,
  Step,
  Trace,
  Verdict,
} from "./types";

/** Look-ahead window for action-kind alignment. Small misalignments
 *  (1-2 step drift between record and replay) re-sync inside this
 *  window without cascading. Larger drift falls through to a parallel
 *  mismatch (one step_missing + one step_extra) at the boundary. */
const ALIGN_LOOKAHEAD = 10;

export function diff(
  recorded: Trace,
  replayed: Trace,
  rules: ResolvedRules,
): Verdict {
  const drifts: Drift[] = [];
  const recSteps = recorded.steps;
  const repSteps = replayed.steps;

  // Two-pointer alignment by (driver, kind). When the heads diverge,
  // look ahead a window on each side for the missing/extra step and
  // skip past it as step_missing or step_extra. Prevents a single
  // missed step from cascading state drifts onto every subsequent step.
  let i = 0;
  let j = 0;
  // Track the previous COMPARED states per side so the `walk` short-
  // circuit (cell didn't move on either side) keeps working across
  // alignment skips.
  let prevRec: unknown = recorded.initialState;
  let prevRep: unknown = replayed.initialState;

  while (i < recSteps.length || j < repSteps.length) {
    if (i >= recSteps.length) {
      drifts.push(d(j, "", undefined, repSteps[j].action, "step_extra"));
      prevRep = repSteps[j].stateAfter;
      j++;
      continue;
    }
    if (j >= repSteps.length) {
      drifts.push(stepMissingDrift(i, recSteps[i].action));
      prevRec = recSteps[i].stateAfter;
      i++;
      continue;
    }
    if (sameKind(recSteps[i].action, repSteps[j].action)) {
      // A synthetic replay step is the engine's "I waited and the
      // widget/server didn't emit this in time" marker — its action is
      // copied from recorded for label purposes and its stateAfter is
      // the previous state. Comparing it cell-by-cell would surface
      // the absent state change as N spurious drifts. Surface once as
      // a warn step_missing instead.
      if (repSteps[j].synthetic) {
        drifts.push(stepMissingDrift(i, recSteps[i].action));
      } else {
        comparePair(
          recSteps[i],
          repSteps[j],
          i,
          prevRec,
          prevRep,
          rules,
          drifts,
        );
      }
      prevRec = recSteps[i].stateAfter;
      prevRep = repSteps[j].stateAfter;
      i++;
      j++;
      continue;
    }

    // Heads differ. Find the nearest match in each side's lookahead;
    // whichever side has the closer match (or only one has one) is
    // assumed to be the side that needs to skip forward.
    const recAhead = findKindAhead(recSteps, i + 1, repSteps[j].action);
    const repAhead = findKindAhead(repSteps, j + 1, recSteps[i].action);

    const advanceRec =
      recAhead !== -1 && (repAhead === -1 || recAhead - i <= repAhead - j);
    const advanceRep = !advanceRec && repAhead !== -1;

    if (advanceRec) {
      // recSteps[recAhead] matches repSteps[j]; everything in between
      // on the recorded side is "missing" from the replay.
      while (i < recAhead) {
        drifts.push(stepMissingDrift(i, recSteps[i].action));
        prevRec = recSteps[i].stateAfter;
        i++;
      }
    } else if (advanceRep) {
      // repSteps[repAhead] matches recSteps[i]; everything in between
      // on the replay side is "extra" relative to the recording.
      while (j < repAhead) {
        drifts.push(d(j, "", undefined, repSteps[j].action, "step_extra"));
        prevRep = repSteps[j].stateAfter;
        j++;
      }
    } else {
      // No alignment found within window — emit a parallel mismatch
      // and advance both. Better than cascading; keeps the loop honest.
      drifts.push(stepMissingDrift(i, recSteps[i].action));
      drifts.push(d(i, "", undefined, repSteps[j].action, "step_extra"));
      prevRec = recSteps[i].stateAfter;
      prevRep = repSteps[j].stateAfter;
      i++;
      j++;
    }
  }

  drifts.sort(
    (a, b) => a.stepIndex - b.stepIndex || a.path.localeCompare(b.path),
  );
  return { ok: drifts.every(isSurfacedOk), drifts };
}

function comparePair(
  rec: Step,
  rep: Step,
  stepIndex: number,
  prevRec: unknown,
  prevRep: unknown,
  rules: ResolvedRules,
  drifts: Drift[],
): void {
  if (rec.stateAfter === rep.stateAfter) return;
  const mode: CompareMode = rec.compare ?? "exact";
  walk(
    rec.stateAfter,
    rep.stateAfter,
    prevRec,
    prevRep,
    "",
    stepIndex,
    rules,
    mode,
    drifts,
  );
}

function sameKind(a: Action, b: Action): boolean {
  return a.driver === b.driver && a.kind === b.kind;
}

/** Index of the first step in `steps` from `start` (inclusive) onward
 *  whose action matches `target` by (driver, kind), within
 *  `ALIGN_LOOKAHEAD` slots. Returns -1 if not found. */
function findKindAhead(
  steps: readonly Step[],
  start: number,
  target: Action,
): number {
  const end = Math.min(steps.length, start + ALIGN_LOOKAHEAD);
  for (let k = start; k < end; k++) {
    if (sameKind(steps[k].action, target)) return k;
  }
  return -1;
}

/** Build a step_missing drift, demoting severity to "warn" when the
 *  missing action is async (widget/server source) — those misses are
 *  typically the engine's 2s `awaitMs` budget elapsing before the
 *  widget/server emitted the expected action, not a real regression. */
function stepMissingDrift(stepIndex: number, action: Action): Drift {
  const drift = d(stepIndex, "", action, undefined, "step_missing");
  const src = action.source;
  if (src === "widget" || src === "server") drift.severity = "warn";
  return drift;
}

function isSurfacedOk(drift: Drift): boolean {
  return drift.severity !== "fail" || drift.suppressedBy !== undefined;
}

type CompareMode = "exact" | "shape";

function walk(
  exp: unknown,
  act: unknown,
  prevExp: unknown,
  prevAct: unknown,
  path: string,
  stepIndex: number,
  rules: ResolvedRules,
  mode: CompareMode,
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
      // Shape mode: same JSON type at this leaf is the whole contract.
      // Skip emitting value_differs. Match rules also become moot here.
      if (mode === "shape") return;
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
    // Shape mode walks the common prefix only; differing list length is
    // expected for volatile collections (activities, search results).
    const len =
      mode === "shape"
        ? Math.min(a.length, b.length)
        : Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const cp = `${path}[${i}]`;
      if (i >= a.length) {
        out.push(applyRules(d(stepIndex, cp, undefined, b[i], "extra"), rules));
      } else if (i >= b.length) {
        out.push(
          applyRules(d(stepIndex, cp, a[i], undefined, "missing"), rules),
        );
      } else {
        walk(a[i], b[i], pa[i], pb[i], cp, stepIndex, rules, mode, out);
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
      // Shape mode is forward-compatible: server adding a new field is
      // not a contract break. Suppress extra keys.
      if (mode === "shape") continue;
      out.push(applyRules(d(stepIndex, cp, undefined, ao[k], "extra"), rules));
    } else {
      walk(eo[k], ao[k], peo[k], pao[k], cp, stepIndex, rules, mode, out);
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
