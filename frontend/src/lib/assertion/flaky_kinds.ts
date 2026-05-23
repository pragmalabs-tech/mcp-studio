import isUUID from "validator/lib/isUUID";
import isISO8601 from "validator/lib/isISO8601";
import isJWT from "validator/lib/isJWT";

export type FlakyKind = "uuid" | "iso-date" | "jwt" | "epoch-ms" | null;

/**
 * Classify a leaf value as a known flaky kind, or null if it isn't one.
 * Used by `flaky` mode to decide whether to skip a leaf rather than
 * compare it strictly. Adding a kind = one import + one branch here.
 */
export function flakyKind(v: unknown): FlakyKind {
  if (typeof v === "string") {
    if (isUUID(v)) return "uuid";
    if (isISO8601(v)) return "iso-date";
    if (isJWT(v)) return "jwt";
  }
  if (typeof v === "number" && v > 1e12 && v < 1e14) return "epoch-ms";
  return null;
}
