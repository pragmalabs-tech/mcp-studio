/**
 * Recursively drop object keys whose value is `undefined`. Mirrors what
 * `JSON.stringify` does to objects, so structures that have been through
 * the in-memory pipeline (postMessage / structuredClone, which preserve
 * `undefined`-valued keys) compare equal to ones that have been through
 * JSON storage (which drops them).
 *
 * Used at the widget.intent capture boundary so that record-then-save
 * (JSON round-trip) and live replay (in-memory) produce identical
 * `params` objects for the differ.
 *
 * Notes:
 *  - Arrays are walked; element-level `undefined` is preserved as-is
 *    (matches JS array semantics; JSON would coerce to `null`, but
 *    that's not a concern for widget intent params today).
 *  - Non-plain objects (Date, Map, etc.) are returned by reference —
 *    widget intent params are always plain JSON-ish.
 */
export function stripUndefined<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out as T;
}
