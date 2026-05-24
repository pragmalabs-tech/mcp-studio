import type { RecordedAction } from "@/lib/recorder/schema";
import type { AssertReport } from "@/lib/assertion";
import {
  deleteReplay as apiDeleteReplay,
  getReplay,
  listReplaySummaries,
  putReplay,
} from "@/lib/studio/storage-api";

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

export async function saveReplay(replay: SavedReplay): Promise<void> {
  await putReplay(replay.id, replay);
}

/**
 * Fetch every replay belonging to a test. Lists summaries, filters by
 * `test_id`, then hydrates each into a full `SavedReplay` so callers can
 * read per-step `assert` reports for the history badges. N is typically
 * small (one user's runs against one test); the parallel fetch is fine.
 */
export async function loadReplaysForTest(
  testId: string,
): Promise<SavedReplay[]> {
  const summaries = await listReplaySummaries();
  const ids = summaries.filter((s) => s.test_id === testId).map((s) => s.id);
  const replays = await Promise.all(ids.map((id) => getReplay(id)));
  return replays.filter((r): r is SavedReplay => r !== null);
}

export async function deleteReplay(id: string): Promise<void> {
  await apiDeleteReplay(id);
}
