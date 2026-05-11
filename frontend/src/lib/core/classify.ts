/**
 * Auto-classifier for drift values. Given (expected, actual) returns a
 * Classification when both sides share a known shape — datetime, UUID,
 * epoch integer, JWT/key/high-entropy string. Pure heuristics, no side
 * effects.
 *
 * The differ attaches the result to fail-drifts; the UI uses it to
 * suggest a rule (does not auto-apply). Suggestions for sensitive
 * shapes default to `ignore` rather than `match` so the secret never
 * lands in the trace's rule set.
 */

import type { Classification } from "./types";
import { ISO_8601, UUID } from "./rules";

const JWT = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const AWS_ACCESS_KEY = /^AKIA[A-Z0-9]{16}$/;
const STRIPE_KEY = /^(sk|pk)_(test|live)_[A-Za-z0-9]+$/;
const HIGH_ENTROPY_CHARSET = /^[A-Za-z0-9+/=_-]+$/;
const NINETY_DAYS_S = 90 * 24 * 60 * 60;
const NINETY_DAYS_MS = NINETY_DAYS_S * 1000;

export function classify(
  expected: unknown,
  actual: unknown,
): Classification | null {
  if (typeof expected === "string" && typeof actual === "string") {
    return classifyStrings(expected, actual);
  }
  if (typeof expected === "number" && typeof actual === "number") {
    return classifyNumbers(expected, actual);
  }
  return null;
}

function classifyStrings(e: string, a: string): Classification | null {
  if (ISO_8601.test(e) && ISO_8601.test(a)) {
    return {
      kind: "iso8601",
      sensitive: false,
      suggested: { match: "@iso8601" },
    };
  }
  if (UUID.test(e) && UUID.test(a)) {
    return { kind: "uuid", sensitive: false, suggested: { match: "@uuid" } };
  }
  if (JWT.test(e) && JWT.test(a)) {
    return { kind: "jwt", sensitive: true, suggested: { ignore: true } };
  }
  if (AWS_ACCESS_KEY.test(e) && AWS_ACCESS_KEY.test(a)) {
    return { kind: "aws_key", sensitive: true, suggested: { ignore: true } };
  }
  if (STRIPE_KEY.test(e) && STRIPE_KEY.test(a)) {
    return { kind: "stripe_key", sensitive: true, suggested: { ignore: true } };
  }
  if (looksHighEntropy(e) && looksHighEntropy(a)) {
    return {
      kind: "high_entropy",
      sensitive: true,
      suggested: { ignore: true },
    };
  }
  return null;
}

function classifyNumbers(e: number, a: number): Classification | null {
  if (
    Number.isInteger(e) &&
    Number.isInteger(a) &&
    e >= 1e9 &&
    a >= 1e9 &&
    Math.abs(e - a) <= epochTolerance(e, a)
  ) {
    return { kind: "epoch", sensitive: false, suggested: { match: "@epoch" } };
  }
  return null;
}

function looksHighEntropy(s: string): boolean {
  return s.length >= 32 && HIGH_ENTROPY_CHARSET.test(s);
}

/** Epoch values come as seconds (10 digits) or milliseconds (13 digits).
 *  Tolerance scales: ~90 days in whichever unit both sides appear to
 *  share. If lengths differ wildly, fall back to seconds tolerance. */
function epochTolerance(a: number, b: number): number {
  const mag = Math.min(a, b);
  return mag >= 1e12 ? NINETY_DAYS_MS : NINETY_DAYS_S;
}
