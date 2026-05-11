/**
 * Per-trace assertion rules: resolves layered rules (built-in driver
 * defaults + per-trace overrides) into a single ResolvedRules, and
 * implements matcher checks for shape-based assertions.
 *
 * Matcher tokens replace exact-equality with format/shape validation:
 *   @any      — accept any value (both sides must be present)
 *   @iso8601  — string matching ISO-8601 datetime
 *   @uuid     — string matching UUID (any version)
 *   @epoch    — integer in plausible epoch range (>= 1e9)
 *   {regex}   — user-supplied pattern (string values only)
 *
 * Resolution order: built-in entries come first, trace entries last.
 * For `match`, callers should scan from the END to find the wining
 * pattern (trace overrides builtin). For `ignore`, presence is enough.
 */

import { allVolatilePaths, builtinMatch } from "./registry";
import { matchesAnyPattern } from "./util/path-match";
import type { Matcher, ResolvedRules, Trace, TraceRules } from "./types";

export function resolveRules(trace: Trace): ResolvedRules {
  const ignore: ResolvedRules["ignore"] = [
    ...allVolatilePaths().map(
      (pattern) => ({ pattern, layer: "builtin.ignore" }) as const,
    ),
    ...(trace.rules?.ignore ?? []).map(
      (pattern) => ({ pattern, layer: "trace.ignore" }) as const,
    ),
  ];
  const match: ResolvedRules["match"] = [
    ...Object.entries(builtinMatch()).map(
      ([pattern, matcher]) =>
        ({ pattern, matcher, layer: "builtin.match" }) as const,
    ),
    ...Object.entries(trace.rules?.match ?? {}).map(
      ([pattern, matcher]) =>
        ({ pattern, matcher, layer: "trace.match" }) as const,
    ),
  ];
  return { ignore, match };
}

/** Empty resolved rules. Useful for tests that want to exercise the
 *  differ without any suppression. */
export function emptyResolvedRules(): ResolvedRules {
  return { ignore: [], match: [] };
}

/** Find the winning match entry for a path, or null if none match.
 *  Iterates from the end so trace entries (added last) override
 *  built-in entries. */
export function findMatch(
  path: string,
  match: ResolvedRules["match"],
): ResolvedRules["match"][number] | null {
  for (let i = match.length - 1; i >= 0; i--) {
    const entry = match[i];
    if (matchesAnyPattern(path, [entry.pattern])) return entry;
  }
  return null;
}

/** Find the first ignore entry whose pattern matches the path. */
export function findIgnore(
  path: string,
  ignore: ResolvedRules["ignore"],
): ResolvedRules["ignore"][number] | null {
  for (const entry of ignore) {
    if (matchesAnyPattern(path, [entry.pattern])) return entry;
  }
  return null;
}

export const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True iff the value satisfies the matcher's shape.
 *  `@any` requires the value to be defined (otherwise it would silently
 *  accept a missing field). */
export function checkMatcher(matcher: Matcher, value: unknown): boolean {
  if (matcher === "@any") return value !== undefined;
  if (matcher === "@iso8601") {
    return typeof value === "string" && ISO_8601.test(value);
  }
  if (matcher === "@uuid") {
    return typeof value === "string" && UUID.test(value);
  }
  if (matcher === "@epoch") {
    return typeof value === "number" && Number.isInteger(value) && value >= 1e9;
  }
  // regex matcher
  if (typeof value !== "string") return false;
  try {
    return new RegExp(matcher.regex).test(value);
  } catch {
    return false;
  }
}

/** Append an `ignore` entry to a trace's rules without duplicates.
 *  Returns a new TraceRules (caller decides whether to persist). */
export function addIgnore(
  rules: TraceRules | undefined,
  path: string,
): TraceRules {
  const existing = rules?.ignore ?? [];
  if (existing.includes(path)) return rules ?? {};
  return { ...rules, ignore: [...existing, path] };
}

/** Set a `match` entry on a trace's rules (overwriting any prior entry
 *  for the same path). */
export function setMatch(
  rules: TraceRules | undefined,
  path: string,
  matcher: Matcher,
): TraceRules {
  return { ...rules, match: { ...rules?.match, [path]: matcher } };
}

/** Remove an `ignore` or `match` entry by path. */
export function removeRule(
  rules: TraceRules | undefined,
  path: string,
): TraceRules {
  const ignore = (rules?.ignore ?? []).filter((p) => p !== path);
  const match = { ...rules?.match };
  delete match[path];
  return { ignore, match };
}
