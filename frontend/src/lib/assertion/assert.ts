import type { State } from "@/lib/state/types";
import type { Action } from "@/lib/action/types";

// Verify action executed successfully (pure check)
export function assertActionSucceeded(action: Action): void {
  const events = action.execute();
  if (events.length === 0) {
    throw new Error(`Action ${action.type} produced no events`);
  }
}

// Verify state changed at given path
export function assertStateChanged(
  before: State,
  after: State,
  path: string,
): void {
  const beforeVal = getPath(before, path);
  const afterVal = getPath(after, path);

  if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) {
    throw new Error(`State at ${path} did not change`);
  }
}

// Helper to get nested property by path
function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}
