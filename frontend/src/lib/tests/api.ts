/**
 * Saved-test API: stored on disk as Cue JSON, executed by translating to
 * Engine IR. The translator runs at the file boundary so the engine never
 * sees the Cue format directly.
 */

import type { Test, TestSummary } from "@/lib/recorder/schema";
import type { Cue } from "@/lib/cue/schema";
import { validateCue, formatValidationErrors } from "@/lib/cue/validate";
import { cueToIr } from "@/lib/cue/to-ir";

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

/**
 * Load a saved Cue file and translate it to the Engine IR `Test` shape the
 * runner consumes. Validation runs first; structural errors throw with the
 * step index and JSON Pointer path so the user can fix the file before any
 * step runs.
 */
export async function getTest(name: string): Promise<Test> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`);
  const json = await unwrap<unknown>(resp);
  const validated = validateCue(json);
  if (!validated.ok) {
    throw new Error(
      `Cue file is invalid:\n${formatValidationErrors(validated.errors)}`,
    );
  }
  return cueToIr(validated.cue);
}

export async function getCue(name: string): Promise<Cue> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`);
  const json = await unwrap<unknown>(resp);
  const validated = validateCue(json);
  if (!validated.ok) {
    throw new Error(
      `Cue file is invalid:\n${formatValidationErrors(validated.errors)}`,
    );
  }
  return validated.cue;
}

export async function saveCue(name: string, cue: Cue): Promise<TestSummary> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cue),
  });
  const summary = await unwrap<BackendSummary>(resp);
  return toSummary(summary);
}

export async function deleteTest(name: string): Promise<void> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  await unwrap<void>(resp);
}
