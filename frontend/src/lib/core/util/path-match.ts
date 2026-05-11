/**
 * Pattern-match a state path against `*` (any object key) and `[*]`
 * (any array index) wildcards. Pattern length must equal path length —
 * no prefix matching.
 */

export function matchesAnyPattern(
  path: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) return false;
  const pSegs = path.split(".");
  for (const pat of patterns) {
    const patSegs = pat.split(".");
    if (patSegs.length !== pSegs.length) continue;
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (!segMatch(patSegs[i], pSegs[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Match a single pattern segment against a path segment.
 *  - `*` matches any segment that has no `[…]` suffix.
 *  - `key[*]` matches the same key with any concrete `[N]` (or `[*]`).
 *  - Otherwise: literal equality.
 */
function segMatch(pat: string, seg: string): boolean {
  if (pat === "*") return !seg.includes("[");
  if (pat === seg) return true;
  if (pat.endsWith("[*]")) {
    const head = pat.slice(0, -3);
    const m = /^(.*)\[[^\]]+\]$/.exec(seg);
    return m !== null && m[1] === head;
  }
  return false;
}
