import type { ActionResult } from "@/lib/action/types";
import type {
  AssertablePoint,
  AssertResult,
  Mode,
  PointFailure,
} from "./types";
import { getByPath } from "./path";
import { compareByMode } from "./dispatch";

/**
 * Verify the live `actual` result against the `recorded` baseline across
 * every assertable point declared by an Action subclass. Each point gets
 * its own mode (from `modes[point.key]`, falling back to the point's
 * declared default). Returns one aggregated `AssertResult`; details for
 * each failing point are surfaced in `data.failures`.
 */
export function verifyAction(
  points: AssertablePoint[],
  recorded: ActionResult | undefined,
  actual: ActionResult | undefined,
  modes: Record<string, Mode> | undefined,
): AssertResult {
  if (!recorded) {
    return { status: "skipped", data: { reason: "no recorded result" } };
  }
  if (!actual) {
    return {
      status: "failed",
      data: {
        expected: recorded,
        reason: "action did not produce a result",
      },
    };
  }

  const failures: PointFailure[] = [];
  for (const point of points) {
    const mode = modes?.[point.key] ?? point.defaultMode;
    if (mode === "ignore") continue;
    const expected = getByPath(recorded, point.path);
    const got = getByPath(actual, point.path);
    const cmp = compareByMode(mode, expected, got);
    if (cmp.status === "failed") {
      failures.push({
        key: point.key,
        mode,
        expected,
        actual: got,
        reason: cmp.data.reason ?? "mismatch",
      });
    }
  }

  if (failures.length) {
    return {
      status: "failed",
      data: { expected: recorded, actual, failures },
    };
  }
  return { status: "passed", data: { expected: recorded, actual } };
}
