import type { RecordedAction } from "@/lib/recorder/schema";
import type { AssertReport } from "@/lib/assertion";

const REPLAYS_STORAGE_KEY = "mcp-studio-replays";

export type ReplayStatus = "passed" | "failed";

/** A replayed action: same shape as a RecordedAction plus the two-part
 *  verify report (action result + state change). */
export interface ReplayedAction extends RecordedAction {
  assert: AssertReport;
  /**
   * The id of the *recorded* action this step replays. The live `action.id`
   * is a fresh uuid created by `reconstructAction`, so the dialog needs this
   * to key per-action assertion config and to find the recorded baseline.
   * Optional for back-compat with replays saved before this field existed.
   */
  recordedActionId?: string;
}

export interface SavedReplay {
  id: string;
  testId: string;
  testName: string;
  createdAt: string;
  durationMs: number;
  status: ReplayStatus;
  actions: ReplayedAction[];
}

export function saveReplay(replay: SavedReplay): void {
  const all = loadReplays();
  all.push(replay);
  localStorage.setItem(REPLAYS_STORAGE_KEY, JSON.stringify(all));
}

export function loadReplays(): SavedReplay[] {
  const stored = localStorage.getItem(REPLAYS_STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function loadReplaysForTest(testId: string): SavedReplay[] {
  return loadReplays().filter((r) => r.testId === testId);
}

export function deleteReplay(id: string): void {
  const filtered = loadReplays().filter((r) => r.id !== id);
  localStorage.setItem(REPLAYS_STORAGE_KEY, JSON.stringify(filtered));
}
