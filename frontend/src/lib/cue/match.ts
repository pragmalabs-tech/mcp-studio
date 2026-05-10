/**
 * Matcher language used everywhere a Cue checks a value: `mcp.call.expect`,
 * `mcp.expect.match`, `widget.expect`, `assert.tool_response.expect`. See
 * `cue-spec.md` §8.
 *
 * One vocabulary, one evaluator. Matchers are JSON values:
 *
 *   42              strict equality
 *   "text"          strict equality
 *   true / false / null
 *   { type: "..." }            JSON type check
 *   { exists: true|false }
 *   { equals: <any> }
 *   { matches: "regex" }
 *   { contains: <value> }      substring or array.includes
 *   { shape: { ... } }         recursive subset deep match
 *   { between: [lo, hi] }
 *   { gte | lte | gt | lt: N }
 *   { length: N | <matcher> }
 *   { all_of: [matchers] }
 *   { any_of: [matchers] }
 *   { not: <matcher> }
 *
 * The `gathered` flag tells the evaluator whether the values came from a
 * wildcard path. Shape-style matchers run per-element when gathered;
 * collection-style matchers (`length`, `contains`, `includes`) run against
 * the gathered array. See spec §8.3.
 */

const COLLECTION_KEYS: ReadonlySet<string> = new Set([
  "length",
  "contains",
  "includes",
]);

const MATCHER_KEYS: ReadonlySet<string> = new Set([
  "type",
  "exists",
  "equals",
  "matches",
  "contains",
  "shape",
  "between",
  "gte",
  "lte",
  "gt",
  "lt",
  "length",
  "all_of",
  "any_of",
  "not",
]);

/** True when an object has at least one known matcher key. Used by `shape`
 *  to decide whether a nested value is a matcher (run it) or a sub-shape
 *  (recurse). To assert literal equality with an object that happens to
 *  carry a matcher key, wrap it in `{ equals: ... }`. */
function looksLikeMatcher(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  for (const k of Object.keys(value)) {
    if (MATCHER_KEYS.has(k)) return true;
  }
  return false;
}

export type MatchResult = { ok: true } | { ok: false; reason: string };

const PASS: MatchResult = { ok: true };

function fail(reason: string): MatchResult {
  return { ok: false, reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

function previewValue(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json && json.length > 80
      ? json.slice(0, 80) + "…"
      : (json ?? "undefined");
  } catch {
    return String(value);
  }
}

function shapeMatch(expected: unknown, actual: unknown): MatchResult {
  // Shape is a recursive subset match: every key in expected must appear in
  // actual and recursively match. Extra keys in actual are allowed.
  //
  // A nested value is treated as a matcher (run it) when it has a known
  // matcher key, otherwise as a sub-shape (recurse). Wrap literal objects
  // that share matcher keys in { equals: ... } to disambiguate.
  if (isPlainObject(expected)) {
    if (looksLikeMatcher(expected)) {
      return runMatcherSingle(expected, actual);
    }
    if (!isPlainObject(actual)) {
      return fail(
        `expected object, got ${jsonType(actual)} (${previewValue(actual)})`,
      );
    }
    for (const [k, sub] of Object.entries(expected)) {
      if (!Object.prototype.hasOwnProperty.call(actual, k)) {
        const present = Object.keys(actual);
        const head = present.slice(0, 5).join(", ");
        const tail = present.length > 5 ? `, … ${present.length - 5} more` : "";
        return fail(
          `missing key "${k}" (actual has: ${head || "<none>"}${tail})`,
        );
      }
      const r = shapeMatch(sub, actual[k]);
      if (!r.ok) return fail(`at "${k}": ${r.reason}`);
    }
    return PASS;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return fail(`expected array, got ${jsonType(actual)}`);
    }
    if (expected.length > actual.length) {
      return fail(
        `expected array of at least ${expected.length} items, got ${actual.length}`,
      );
    }
    for (let i = 0; i < expected.length; i++) {
      const r = shapeMatch(expected[i], actual[i]);
      if (!r.ok) return fail(`at [${i}]: ${r.reason}`);
    }
    return PASS;
  }
  // Leaf: defer to the full matcher language.
  return runMatcherSingle(expected, actual);
}

function runMatcherSingle(matcher: unknown, value: unknown): MatchResult {
  // Literal scalar / null matchers compare strictly.
  if (
    matcher === null ||
    typeof matcher === "string" ||
    typeof matcher === "number" ||
    typeof matcher === "boolean"
  ) {
    return deepEqual(matcher, value)
      ? PASS
      : fail(
          `expected ${JSON.stringify(matcher)}, got ${JSON.stringify(value)}`,
        );
  }

  if (Array.isArray(matcher)) {
    return deepEqual(matcher, value)
      ? PASS
      : fail(`expected array equality with ${JSON.stringify(matcher)}`);
  }

  if (!isPlainObject(matcher)) {
    return fail("matcher must be a JSON value");
  }

  const m = matcher;

  if ("type" in m) {
    const expected = m.type;
    const actual = jsonType(value);
    return actual === expected
      ? PASS
      : fail(`expected type ${String(expected)}, got ${actual}`);
  }

  if ("exists" in m) {
    const wantExists = !!m.exists;
    const exists = value !== undefined;
    if (exists === wantExists) return PASS;
    return wantExists
      ? fail("expected path to exist")
      : fail("expected path to not exist");
  }

  if ("equals" in m) {
    return deepEqual(m.equals, value)
      ? PASS
      : fail(
          `expected equals ${JSON.stringify(m.equals)}, got ${JSON.stringify(value)}`,
        );
  }

  if ("matches" in m) {
    if (typeof value !== "string") {
      return fail(`expected string for regex match, got ${jsonType(value)}`);
    }
    const re = new RegExp(String(m.matches));
    return re.test(value)
      ? PASS
      : fail(`/${re.source}/ did not match "${value}"`);
  }

  if ("contains" in m) {
    if (typeof value === "string") {
      const needle = String(m.contains);
      return value.includes(needle)
        ? PASS
        : fail(`"${value}" does not contain "${needle}"`);
    }
    if (Array.isArray(value)) {
      const needle = m.contains;
      const found = value.some((el) => deepEqual(el, needle));
      return found
        ? PASS
        : fail(`array does not include ${JSON.stringify(needle)}`);
    }
    return fail(`contains needs string or array, got ${jsonType(value)}`);
  }

  if ("shape" in m) {
    return shapeMatch(m.shape, value);
  }

  if ("between" in m) {
    if (typeof value !== "number") {
      return fail(`between needs number, got ${jsonType(value)}`);
    }
    const range = m.between;
    if (!Array.isArray(range) || range.length !== 2) {
      return fail("between expects [lo, hi]");
    }
    const [lo, hi] = range as [number, number];
    return value >= lo && value <= hi
      ? PASS
      : fail(`${value} not in [${lo}, ${hi}]`);
  }

  if ("gte" in m) {
    if (typeof value !== "number")
      return fail(`gte needs number, got ${jsonType(value)}`);
    return value >= (m.gte as number) ? PASS : fail(`${value} < ${m.gte}`);
  }
  if ("gt" in m) {
    if (typeof value !== "number")
      return fail(`gt needs number, got ${jsonType(value)}`);
    return value > (m.gt as number) ? PASS : fail(`${value} <= ${m.gt}`);
  }
  if ("lte" in m) {
    if (typeof value !== "number")
      return fail(`lte needs number, got ${jsonType(value)}`);
    return value <= (m.lte as number) ? PASS : fail(`${value} > ${m.lte}`);
  }
  if ("lt" in m) {
    if (typeof value !== "number")
      return fail(`lt needs number, got ${jsonType(value)}`);
    return value < (m.lt as number) ? PASS : fail(`${value} >= ${m.lt}`);
  }

  if ("length" in m) {
    let len: number;
    if (typeof value === "string") len = value.length;
    else if (Array.isArray(value)) len = value.length;
    else return fail(`length needs string or array, got ${jsonType(value)}`);
    if (typeof m.length === "number") {
      return len === m.length
        ? PASS
        : fail(`expected length ${m.length}, got ${len}`);
    }
    return runMatcherSingle(m.length, len);
  }

  if ("all_of" in m) {
    const list = m.all_of;
    if (!Array.isArray(list)) return fail("all_of expects an array");
    for (let i = 0; i < list.length; i++) {
      const r = runMatcherSingle(list[i], value);
      if (!r.ok) return fail(`all_of[${i}]: ${r.reason}`);
    }
    return PASS;
  }

  if ("any_of" in m) {
    const list = m.any_of;
    if (!Array.isArray(list)) return fail("any_of expects an array");
    const reasons: string[] = [];
    for (const sub of list) {
      const r = runMatcherSingle(sub, value);
      if (r.ok) return PASS;
      reasons.push(r.reason);
    }
    return fail(`no any_of branch matched: ${reasons.join("; ")}`);
  }

  if ("not" in m) {
    const r = runMatcherSingle(m.not, value);
    return r.ok ? fail("expected matcher to not pass") : PASS;
  }

  // Fall-through: object literal compared by deep equality.
  return deepEqual(m, value) ? PASS : fail("object did not deep-equal matcher");
}

/**
 * Run `matcher` against `values` resolved from a path. `gathered` is true
 * when the path traversed a wildcard. Collection-style matchers run against
 * the gathered array; everything else runs per-element.
 */
export function runMatcher(
  matcher: unknown,
  values: unknown[],
  gathered: boolean,
): MatchResult {
  // Special case: an `exists` matcher decides on values.length, not on a
  // single value (because a missing path resolves to []).
  if (isPlainObject(matcher) && "exists" in matcher) {
    const wantExists = !!matcher.exists;
    const exists = values.length > 0;
    if (exists === wantExists) return PASS;
    return wantExists
      ? fail("expected path to exist")
      : fail("expected path to not exist");
  }

  if (values.length === 0) {
    // `not <X>` on a missing path passes — the inner matcher couldn't have
    // matched anyway. Common case: an implicit assertion like
    // `result.isError != true` against a method whose result has no
    // `isError` field (resources/read, prompts/get).
    if (isPlainObject(matcher) && "not" in matcher) return PASS;
    // `any_of` passes if any branch tolerates a missing path.
    if (isPlainObject(matcher) && "any_of" in matcher) {
      const branches = (matcher as { any_of?: unknown }).any_of;
      if (Array.isArray(branches)) {
        for (const b of branches) {
          const sub = runMatcher(b, [], false);
          if (sub.ok) return PASS;
        }
      }
    }
    return fail("path resolved to nothing");
  }

  // Collection matchers operate on the gathered array as a whole.
  if (gathered && isPlainObject(matcher)) {
    for (const k of Object.keys(matcher)) {
      if (COLLECTION_KEYS.has(k)) {
        return runMatcherSingle(matcher, values);
      }
    }
  }

  if (gathered) {
    for (let i = 0; i < values.length; i++) {
      const r = runMatcherSingle(matcher, values[i]);
      if (!r.ok) return fail(`element[${i}]: ${r.reason}`);
    }
    return PASS;
  }

  return runMatcherSingle(matcher, values[0]);
}
