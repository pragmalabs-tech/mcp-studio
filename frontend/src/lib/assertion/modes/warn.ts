import type { AssertResult } from "../types";
import { deepEqual } from "./exact";

export function modeWarn(expected: unknown, actual: unknown): AssertResult {
  return deepEqual(expected, actual)
    ? { status: "passed", data: { expected, actual } }
    : {
        status: "warn",
        data: { expected, actual, reason: "mismatch (warning only)" },
      };
}
