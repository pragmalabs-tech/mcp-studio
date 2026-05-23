import type { AssertResult } from "../types";

export function modeIgnore(): AssertResult {
  return { status: "passed", data: { reason: "ignored" } };
}
