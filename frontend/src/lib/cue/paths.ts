/**
 * Dot-path syntax used by Cue's `expect`, `bind`, and `match` blocks.
 * Boring on purpose: paths show up in error messages, so the syntax stays
 * easy to print and explain. See `cue-spec.md` §3.
 *
 * Supported:
 *   a.b.c        nested object property
 *   a[0]         array index
 *   a[*]         wildcard (gather every element)
 *   a["weird"]   bracket form for keys that don't fit the bare-identifier rule
 *   $            root of the value being matched
 *
 * Not supported (intentionally): recursive descent (`..`), filter predicates
 * (`?(...)`), function calls. Reach for these only if a real Cue needs them.
 */

export type PathSegment =
  | { kind: "root" }
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" };

export interface ResolveResult {
  /** Values found at the path. Empty when nothing matched. */
  values: unknown[];
  /** True when the path traversed at least one wildcard, so callers know the
   *  matcher should run per-element vs. against the gathered array. */
  gathered: boolean;
}

export class PathParseError extends Error {
  readonly input: string;
  readonly position: number;
  constructor(input: string, position: number, message: string) {
    super(`${message} (at "${input}":${position})`);
    this.name = "PathParseError";
    this.input = input;
    this.position = position;
  }
}

/**
 * Parse a path string into segments. Throws `PathParseError` on malformed
 * input rather than returning a partial result, so callers can surface the
 * exact position to the user.
 */
export function parsePath(input: string): PathSegment[] {
  if (input.length === 0) {
    throw new PathParseError(input, 0, "empty path");
  }

  const segments: PathSegment[] = [];
  let i = 0;

  // Optional leading "$" denotes the root explicitly. "$" alone resolves to
  // the value as-is; "$.foo" is equivalent to "foo". Either way the root
  // segment is implicit in our resolver.
  if (input[0] === "$") {
    segments.push({ kind: "root" });
    i = 1;
    if (i < input.length && input[i] !== "." && input[i] !== "[") {
      throw new PathParseError(input, i, "expected '.' or '[' after '$'");
    }
    if (input[i] === ".") i++;
  }

  while (i < input.length) {
    const ch = input[i];

    if (ch === "[") {
      const closeAt = input.indexOf("]", i);
      if (closeAt === -1) {
        throw new PathParseError(input, i, "unterminated '['");
      }
      const inner = input.slice(i + 1, closeAt);
      if (inner === "*") {
        segments.push({ kind: "wildcard" });
      } else if (/^-?\d+$/.test(inner)) {
        segments.push({ kind: "index", index: parseInt(inner, 10) });
      } else if (inner.startsWith('"') && inner.endsWith('"')) {
        // Bracketed string key. Supports basic backslash-escaped quotes
        // and backslashes; full JSON string semantics aren't needed.
        const raw = inner.slice(1, -1);
        const key = raw.replace(/\\(["\\])/g, "$1");
        segments.push({ kind: "key", key });
      } else {
        throw new PathParseError(
          input,
          i + 1,
          `expected number, '*', or quoted string inside [], got "${inner}"`,
        );
      }
      i = closeAt + 1;
      // Optional dot before the next bare key segment.
      if (input[i] === ".") i++;
      continue;
    }

    if (ch === ".") {
      throw new PathParseError(input, i, "unexpected '.'");
    }

    // Bare identifier key: read up to the next "." or "[".
    let j = i;
    while (j < input.length && input[j] !== "." && input[j] !== "[") j++;
    const key = input.slice(i, j);
    if (key.length === 0) {
      throw new PathParseError(input, i, "empty key");
    }
    segments.push({ kind: "key", key });
    i = j;
    if (input[i] === ".") i++;
  }

  return segments;
}

/**
 * Walk `value` along `segments` and return every endpoint. Wildcards fan out:
 * a path like `a[*].b` resolved against `{ a: [{ b: 1 }, { b: 2 }] }` yields
 * `[1, 2]` with `gathered: true`. A miss anywhere along the path yields an
 * empty array; callers distinguish "value is undefined" from "path doesn't
 * exist" by checking `values.length`.
 */
export function resolvePath(
  value: unknown,
  segments: PathSegment[],
): ResolveResult {
  let current: unknown[] = [value];
  let gathered = false;

  for (const seg of segments) {
    if (seg.kind === "root") {
      // Already pointing at the root.
      continue;
    }

    const next: unknown[] = [];
    for (const v of current) {
      if (seg.kind === "key") {
        if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
        const obj = v as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(obj, seg.key)) {
          next.push(obj[seg.key]);
        }
      } else if (seg.kind === "index") {
        if (!Array.isArray(v)) continue;
        const idx = seg.index < 0 ? v.length + seg.index : seg.index;
        if (idx >= 0 && idx < v.length) next.push(v[idx]);
      } else if (seg.kind === "wildcard") {
        if (!Array.isArray(v)) continue;
        gathered = true;
        for (const el of v) next.push(el);
      }
    }
    current = next;
    if (current.length === 0) break;
  }

  return { values: current, gathered };
}

/** Render a parsed path back to its canonical string form. Used in error
 *  messages and the report's `details` blocks so users see what was tried. */
export function formatPath(segments: PathSegment[]): string {
  if (segments.length === 0) return "$";
  let out = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "root") {
      out += "$";
    } else if (seg.kind === "key") {
      const safe = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg.key);
      if (safe) {
        if (out.length > 0 && !out.endsWith("$")) out += ".";
        out += seg.key;
      } else {
        out += `["${seg.key.replace(/(["\\])/g, "\\$1")}"]`;
      }
    } else if (seg.kind === "index") {
      out += `[${seg.index}]`;
    } else if (seg.kind === "wildcard") {
      out += "[*]";
    }
  }
  return out || "$";
}
