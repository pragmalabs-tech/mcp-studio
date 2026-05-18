/**
 * Saved-test API. Persists Trace JSON directly; the new engine loads
 * what was captured, byte-for-byte.
 */

import type { TestSummary } from "@/lib/recorder/schema";
import { loadTrace, saveTrace as serializeTrace } from "@/lib/core/trace-io";
import type { Trace, Verdict } from "@/lib/core/types";
import type { RunFile, RunFileSummary } from "./run-result-schema";
import { summarize } from "./run-result-schema";

interface BackendSummary {
  name: string;
  size: number;
  modified_ms: number;
  display_name?: string | null;
  description?: string | null;
  created_at?: string | null;
  total_actions?: number | null;
  tags?: string[] | null;
}

function toSummary(s: BackendSummary): TestSummary {
  return {
    name: s.name,
    displayName: s.display_name ?? undefined,
    description: s.description ?? undefined,
    createdAt: s.created_at ?? undefined,
    totalActions: s.total_actions ?? undefined,
    tags: s.tags ?? undefined,
    size: s.size,
    modifiedMs: s.modified_ms,
  };
}

async function unwrap<T>(resp: Response): Promise<T> {
  if (resp.ok) {
    if (resp.status === 204) return undefined as unknown as T;
    return (await resp.json()) as T;
  }
  let message = `HTTP ${resp.status}`;
  try {
    const body = await resp.json();
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    /* non-JSON body */
  }
  throw new Error(message);
}

export async function listTests(): Promise<TestSummary[]> {
  const resp = await fetch("/api/studio/tests");
  const list = await unwrap<BackendSummary[]>(resp);
  return list.map(toSummary);
}

/** Load a saved test and validate it against the current Trace schema.
 *  Legacy Test envelope shape is auto-migrated by `loadTrace`. */
export async function getTrace(name: string): Promise<Trace> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`);
  const json = await unwrap<unknown>(resp);
  return loadTrace(json);
}

export async function saveTrace(
  name: string,
  trace: Trace,
): Promise<TestSummary> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializeTrace(trace)),
  });
  return toSummary(await unwrap<BackendSummary>(resp));
}

export async function deleteTest(name: string): Promise<void> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  await unwrap<void>(resp);
}

// ── Run-result API ──

interface BackendRunSummary {
  id: string;
  size: number;
  modified_ms: number;
  run_type?: string | null;
  started_at?: number | null;
  finished_at?: number | null;
  filter?: RunFileSummary["filter"] | null;
  env?: RunFileSummary["env"] | null;
  summary?: RunFileSummary["summary"] | null;
}

function toRunSummary(s: BackendRunSummary): RunFileSummary {
  // Legacy files (written before the `runType` field existed) were all
  // produced by the Run-all path. Default them to "batch" so the grouping
  // UI doesn't put them in the wrong bucket.
  const runType = s.run_type === "standalone" ? "standalone" : "batch";
  return {
    id: s.id,
    size: s.size,
    modifiedMs: s.modified_ms,
    runType,
    startedAt: s.started_at ?? undefined,
    finishedAt: s.finished_at ?? undefined,
    filter: s.filter ?? undefined,
    env: s.env ?? undefined,
    summary: s.summary ?? undefined,
  };
}

export async function listRunResults(): Promise<RunFileSummary[]> {
  const resp = await fetch("/api/studio/run-results");
  const list = await unwrap<BackendRunSummary[]>(resp);
  return list.map(toRunSummary);
}

export async function getRunResult(id: string): Promise<RunFile> {
  const resp = await fetch(`/api/studio/run-results/${encodeURIComponent(id)}`);
  return unwrap<RunFile>(resp);
}

export async function saveRunResult(file: RunFile): Promise<RunFileSummary> {
  const resp = await fetch(
    `/api/studio/run-results/${encodeURIComponent(file.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file),
    },
  );
  return toRunSummary(await unwrap<BackendRunSummary>(resp));
}

export async function deleteRunResult(id: string): Promise<void> {
  const resp = await fetch(
    `/api/studio/run-results/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  await unwrap<void>(resp);
}

/** Patch a single test entry inside a saved run-result file with an
 *  updated recorded trace + verdict (after the user applied a rule from
 *  within the trace viewer). Loads the file, mutates the matching entry,
 *  re-aggregates the summary, and writes back. Throws if the file or
 *  matching entry is missing. */
export async function updateRunResultEntry(
  fileId: string,
  testFsName: string,
  recorded: Trace,
  verdict: Verdict,
): Promise<void> {
  const file = await getRunResult(fileId);
  const idx = file.results.findIndex((e) => e.testFsName === testFsName);
  if (idx === -1) {
    throw new Error(
      `Run-result ${fileId} has no entry for testFsName ${testFsName}`,
    );
  }
  file.results[idx] = {
    ...file.results[idx],
    recorded,
    verdict,
    status: verdict.ok ? "passed" : "failed",
  };
  file.summary = summarize(file.results);
  await saveRunResult(file);
}
