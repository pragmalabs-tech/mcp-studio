import type { AssertablePoint, Mode, TestAssertionConfig } from "./types";

/**
 * Build the per-point mode map for a specific action. Override chain:
 *   `cfg.perAction[actionId].result[key]` → `point.defaultMode`.
 *
 * Every declared point gets an entry; callers can rely on `out[key]`
 * being defined for any `point.key`.
 */
export function resolveResultModes(
  cfg: TestAssertionConfig | undefined,
  actionId: string,
  points: AssertablePoint[],
): Record<string, Mode> {
  const overrides = cfg?.perAction?.[actionId]?.result ?? {};
  const out: Record<string, Mode> = {};
  for (const p of points) {
    out[p.key] = overrides[p.key] ?? p.defaultMode;
  }
  return out;
}

/**
 * Resolve the state-scope mode. Override chain:
 *   `cfg.perAction[actionId].state` → `cfg.defaults.state` → `"exact"`.
 */
export function resolveStateMode(
  cfg: TestAssertionConfig | undefined,
  actionId: string,
): Mode {
  return cfg?.perAction?.[actionId]?.state ?? cfg?.defaults?.state ?? "exact";
}
