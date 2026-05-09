import type { Test, TestSummary } from "@/lib/recorder/schema";

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

export async function getTest(name: string): Promise<Test> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`);
  return unwrap<Test>(resp);
}

export async function saveTest(name: string, test: Test): Promise<TestSummary> {
  const resp = await fetch(`/api/studio/tests/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(test),
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
