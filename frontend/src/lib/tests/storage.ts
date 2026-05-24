import { migrateSession, type Session } from "@/lib/recorder/schema";
import type { TestAssertionConfig } from "@/lib/assertion";
import {
  deleteTest as apiDeleteTest,
  getTest as apiGetTest,
  listTestSummaries,
  putTest,
} from "@/lib/studio/storage-api";
import { slugify } from "./format";

export interface SavedTest {
  /** Filename slug derived from `name` via `slugify`. Also the path
   *  segment under `/api/studio/tests/{id}`. Stable across writes; renaming
   *  the display name produces a new slug. */
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  session: Session;
  /**
   * Per-test assertion config. Optional — when absent every action falls
   * back to its `AssertablePoint.defaultMode` and state falls back to
   * `"exact"`, preserving the pre-v2 replay behavior.
   */
  assertions?: TestAssertionConfig;
}

/**
 * Hydrate every test into its full `SavedTest` shape. Lists summaries,
 * fetches each body in parallel, drops anything that 404s mid-flight.
 * Used by the catalog page where we need the session bodies for action
 * counts and replay-history hookup. For one-test access prefer the
 * single-fetch `getTest(slug)` to avoid hydrating the whole catalog.
 */
export async function loadTests(): Promise<SavedTest[]> {
  const summaries = await listTestSummaries();
  const bodies = await Promise.all(summaries.map((s) => apiGetTest(s.name)));
  return bodies
    .filter((t): t is SavedTest => t !== null)
    .map((t) => ({ ...t, session: migrateSession(t.session) }));
}

export async function getTest(slug: string): Promise<SavedTest | null> {
  const test = await apiGetTest(slug);
  if (!test) return null;
  return { ...test, session: migrateSession(test.session) };
}

/**
 * Persist a SavedTest. The id is derived from `test.name` so the filename
 * matches what the user typed; renames produce a new slug (and orphan the
 * old file — explicit delete is left to the caller's "save under new
 * name" UX). Sessions are normalized to the current schema before PUT so
 * disk doesn't lag the in-memory shape. Returns the slug.
 */
export async function saveTest(test: SavedTest): Promise<string> {
  const slug = slugify(test.name);
  await putTest(slug, {
    ...test,
    id: slug,
    session: migrateSession(test.session),
  });
  return slug;
}

export async function deleteTest(slug: string): Promise<void> {
  await apiDeleteTest(slug);
}

/**
 * Patch the `assertions` field on a saved test. Both the test detail
 * view and the replay result dialog write through this helper, so the
 * backend file is the single source of truth.
 */
export async function updateTestAssertions(
  slug: string,
  cfg: TestAssertionConfig,
): Promise<void> {
  const existing = await apiGetTest(slug);
  if (!existing) return;
  await putTest(slug, { ...existing, assertions: cfg });
}
