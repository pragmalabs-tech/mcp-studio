/**
 * Pure helpers that mutate a recorded Trace and re-diff against the
 * existing replay. Each returns the new recorded + verdict; persistence
 * (saveTrace, state setters) is the caller's job: the Tests panel and
 * the run-result viewer have different write paths.
 */

import { diff } from "./differ";
import { resolveRules } from "./rules";
import type { Trace, TraceRules, Verdict } from "./types";

export function applyCompareMode(
  recorded: Trace,
  replayed: Trace,
  stepIndex: number,
  mode: "exact" | "shape",
): { recorded: Trace; verdict: Verdict } {
  const nextSteps = recorded.steps.map((s, i) =>
    i === stepIndex
      ? { ...s, compare: mode === "exact" ? undefined : mode }
      : s,
  );
  const nextRecorded: Trace = { ...recorded, steps: nextSteps };
  return rediff(nextRecorded, replayed);
}

export function applyRules(
  recorded: Trace,
  replayed: Trace,
  nextRules: TraceRules,
): { recorded: Trace; verdict: Verdict } {
  const nextRecorded: Trace = { ...recorded, rules: nextRules };
  return rediff(nextRecorded, replayed);
}

function rediff(
  recorded: Trace,
  replayed: Trace,
): { recorded: Trace; verdict: Verdict } {
  return {
    recorded,
    verdict: diff(recorded, replayed, resolveRules(recorded)),
  };
}
