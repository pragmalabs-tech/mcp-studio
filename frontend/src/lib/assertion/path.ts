import get from "lodash.get";

/**
 * Resolve a dotted/bracketed path against an arbitrary JSON value.
 * Thin wrapper around `lodash.get` so the rest of the assertion engine
 * has one swap point if we ever move to a pattern library.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return get(obj as object, path);
}
