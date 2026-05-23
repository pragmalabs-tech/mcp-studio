import type { AssertResult, Mode } from "./types";
import { modeExact } from "./modes/exact";
import { modeShape } from "./modes/shape";
import { modeFlaky } from "./modes/flaky";
import { modeIgnore } from "./modes/ignore";

/**
 * One place to add a new mode: extend `Mode` in `types.ts`, add a file
 * under `modes/`, and add a branch here.
 */
export function compareByMode(
  mode: Mode,
  expected: unknown,
  actual: unknown,
): AssertResult {
  switch (mode) {
    case "exact":
      return modeExact(expected, actual);
    case "shape":
      return modeShape(expected, actual);
    case "flaky":
      return modeFlaky(expected, actual);
    case "ignore":
      return modeIgnore();
  }
}
