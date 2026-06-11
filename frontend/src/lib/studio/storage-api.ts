/**
 * Storage API client. Tests live at `~/.mcp-studio/tests/<slug>.json`,
 * replays at `~/.mcp-studio/run-results/<id>.json`. Backend is the
 * studio's own axum process on the same origin, so requests are plain
 * relative `/api/studio/*` fetches (matches `profiles-api.ts`).
 *
 * The studio frontend owns both wire shapes (`SavedTest`, `SavedReplay`);
 * the backend stores opaque JSON and only lifts summary fields for the
 * catalog list. Callers should treat 404 as "not found" rather than an
 * error.
 */

import type { SavedTest } from "@/lib/tests/storage";
import type { SavedReplay } from "@/lib/replays/storage";

export interface TestSummary {
  /** Filename slug. Stable id used for GET/PUT/DELETE under this name. */
  name: string;
  size: number;
  modified_ms: number;
  display_name: string | null;
  description: string | null;
  created_at: string | null;
}

export interface ReplaySummary {
  id: string;
  size: number;
  modified_ms: number;
  test_id: string | null;
  started_at: number | null;
  finished_at: number | null;
  run_type: string | null;
  filter: unknown;
  env: unknown;
  summary: unknown;
  test_name: string | null;
  status: string | null;
  duration_ms: number | null;
  run_group_id: string | null;
  profile_name: string | null;
}

async function asJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* fall through */
    }
    throw new Error(detail);
  }
  return resp.json() as Promise<T>;
}

async function ok(resp: Response): Promise<void> {
  if (!resp.ok && resp.status !== 204) {
    let detail = `${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* fall through */
    }
    throw new Error(detail);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

export async function listTestSummaries(): Promise<TestSummary[]> {
  return asJson<TestSummary[]>(await fetch("/api/studio/tests"));
}

/** Returns null on 404 — "not found" isn't an error condition for callers. */
export async function getTest(slug: string): Promise<SavedTest | null> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(slug)}`);
  if (resp.status === 404) return null;
  return asJson<SavedTest>(resp);
}

export async function putTest(
  slug: string,
  body: SavedTest,
): Promise<TestSummary> {
  return asJson<TestSummary>(
    await fetch(`/api/studio/tests/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteTest(slug: string): Promise<void> {
  await ok(
    await fetch(`/api/studio/tests/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    }),
  );
}

// ── Replays ───────────────────────────────────────────────────────────────

export interface ListReplaySummariesParams {
  limit?: number;
  offset?: number;
  testId?: string;
}

export async function listReplaySummaries(
  params: ListReplaySummariesParams = {},
): Promise<ReplaySummary[]> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.testId != null) qs.set("test_id", params.testId);
  const query = qs.size > 0 ? `?${qs.toString()}` : "";
  return asJson<ReplaySummary[]>(
    await fetch(`/api/studio/run-results${query}`),
  );
}

export async function getReplay(id: string): Promise<SavedReplay | null> {
  const resp = await fetch(`/api/studio/run-results/${encodeURIComponent(id)}`);
  if (resp.status === 404) return null;
  return asJson<SavedReplay>(resp);
}

export async function putReplay(
  id: string,
  body: SavedReplay,
): Promise<ReplaySummary> {
  return asJson<ReplaySummary>(
    await fetch(`/api/studio/run-results/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteReplay(id: string): Promise<void> {
  await ok(
    await fetch(`/api/studio/run-results/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  );
}
