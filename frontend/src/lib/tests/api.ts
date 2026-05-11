/**
 * Saved-test API. Persists Trace JSON directly; the new engine loads
 * what was captured, byte-for-byte.
 */

import type { TestSummary } from "@/lib/recorder/schema";
import { loadTrace, saveTrace as serializeTrace } from "@/lib/core/trace-io";
import type { Trace } from "@/lib/core/types";

interface BackendSummary {
  name: string;
  size: number;
  modified_ms: number;
  display_name?: string | null;
  description?: string | null;
  created_at?: string | null;
  total_actions?: number | null;
}

function toSummary(s: BackendSummary): TestSummary {
  return {
    name: s.name,
    displayName: s.display_name ?? undefined,
    description: s.description ?? undefined,
    createdAt: s.created_at ?? undefined,
    totalActions: s.total_actions ?? undefined,
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
