import type { AssertResult } from "../types";
import { flakyKind } from "../flaky_kinds";

export function modeFlaky(expected: unknown, actual: unknown): AssertResult {
  return walk(expected, actual)
    ? { status: "passed", data: { expected, actual } }
    : {
        status: "failed",
        data: { expected, actual, reason: "flaky-aware mismatch" },
      };
}

function isScalar(v: unknown): v is string | number | boolean | null {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

function walk(a: unknown, b: unknown): boolean {
  const ka = flakyKind(a);
  const kb = flakyKind(b);
  // Both leaves are flaky and of the same kind → treat as equal regardless of value.
  if (ka && ka === kb) return true;
  // One side flaky-kind, other not → real diff.
  if (ka || kb) return false;

  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    // Scalar-only arrays: order-insensitive (same elements, any order).
    if (a.every(isScalar) && b.every(isScalar)) {
      const remaining = [...b] as Array<string | number | boolean | null>;
      for (const el of a as Array<string | number | boolean | null>) {
        const idx = remaining.indexOf(el);
        if (idx === -1) return false;
        remaining.splice(idx, 1);
      }
      return true;
    }
    for (let i = 0; i < a.length; i++) {
      if (!walk(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!walk(ao[k], bo[k])) return false;
  }
  return true;
}
