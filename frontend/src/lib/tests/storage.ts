import type { Session } from "@/lib/recorder/schema";
import type { TestAssertionConfig } from "@/lib/assertion";
import {
  deleteTest as apiDeleteTest,
  getTest as apiGetTest,
  listTestSummaries,
  putTest,
} from "@/lib/studio/storage-api";

export interface SavedTest {
  /** Stable unique id (UUID) assigned at creation. Doubles as the backend
   *  filename and the path segment under `/api/studio/tests/{id}`. Has no
   *  relationship to the user-visible `name` — renaming the display name
   *  does NOT change the id. Two tests can share a name. */
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  session: Session;
  /**
   * Per-test assertion config. Optional — when absent every action falls
   * back to its `AssertablePoint.defaultMode` and state falls back to
   * `"exact"`.
   */
  assertions?: TestAssertionConfig;
}

/**
 * Hydrate every test into its full `SavedTest` shape. Lists summaries,
 * fetches each body in parallel, drops anything that 404s mid-flight.
 * Used by the catalog page where we need the session bodies for action
 * counts and replay-history hookup. For one-test access prefer the
 * single-fetch `getTest(id)` to avoid hydrating the whole catalog.
 */
export async function loadTests(): Promise<SavedTest[]> {
  const summaries = await listTestSummaries();
  const bodies = await Promise.all(summaries.map((s) => apiGetTest(s.name)));
  return bodies.filter((t): t is SavedTest => t !== null);
}

export async function getTest(id: string): Promise<SavedTest | null> {
  return await apiGetTest(id);
}

/**
 * Persist a SavedTest under its own id (caller assigns at creation). Two
 * tests with the same name save to distinct files because their ids are
 * different UUIDs. Returns the id.
 */
export async function saveTest(test: SavedTest): Promise<string> {
  await putTest(test.id, test);
  return test.id;
}

export async function deleteTest(id: string): Promise<void> {
  await apiDeleteTest(id);
}

/**
 * Patch the `assertions` field on a saved test. Both the test detail
 * view and the replay result dialog write through this helper, so the
 * backend file is the single source of truth.
 */
export async function updateTestAssertions(
  id: string,
  cfg: TestAssertionConfig,
): Promise<void> {
  const existing = await apiGetTest(id);
  if (!existing) return;
  await putTest(id, { ...existing, assertions: cfg });
}
