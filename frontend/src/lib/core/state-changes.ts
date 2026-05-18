/**
 * Pure deep diff between two unknown values, returning the leaf-level
 * paths whose value changed. Used by the test inspector to surface
 * "what does this step assert" without making the user open the
 * trace-modal diff viewer.
 *
 * Granularity matches the differ: when an object's value changes, we
 * walk into it and report the specific leaves that differ; only when
 * either side is not a plain object do we emit a change at the
 * current path. That keeps reports concise for the common case where
 * one nested field updated within a larger structure.
 */

export interface StateChange {
  path: string;
  /** Previous value, or `undefined` if the key didn't exist before. */
  before: unknown;
  /** New value, or `undefined` if the key no longer exists. */
  after: unknown;
}

export function computeStateChanges(
  before: unknown,
  after: unknown,
): StateChange[] {
  const out: StateChange[] = [];
  walk(before, after, "", out);
  return out;
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  out: StateChange[],
): void {
  if (before === after) return;

  const bIsObj = isPlainObject(before);
  const aIsObj = isPlainObject(after);
  if (bIsObj && aIsObj) {
    const bo = before as Record<string, unknown>;
    const ao = after as Record<string, unknown>;
    const keys = unionKeys(Object.keys(bo), Object.keys(ao));
    for (const k of keys) {
      const sub = path ? `${path}.${k}` : k;
      walk(bo[k], ao[k], sub, out);
    }
    return;
  }

  const bIsArr = Array.isArray(before);
  const aIsArr = Array.isArray(after);
  if (bIsArr && aIsArr) {
    const ba = before as unknown[];
    const aa = after as unknown[];
    const len = Math.max(ba.length, aa.length);
    for (let i = 0; i < len; i++) {
      walk(ba[i], aa[i], `${path}[${i}]`, out);
    }
    return;
  }

  if (!shallowEqual(before, after)) {
    out.push({ path, before, after });
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  return false;
}

function unionKeys(a: string[], b: string[]): string[] {
  const set = new Set<string>();
  for (const k of a) set.add(k);
  for (const k of b) set.add(k);
  return [...set].sort();
}
