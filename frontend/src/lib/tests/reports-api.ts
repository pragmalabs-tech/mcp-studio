import type { ReplayReport } from "@/lib/engine/report";

interface BackendReportSummary {
  name: string;
  size: number;
  modified_ms: number;
  test_name?: string | null;
  run_id?: string | null;
  passed?: number | null;
  failed?: number | null;
  total?: number | null;
  started_at?: string | null;
}

export interface ReportSummary {
  name: string;
  size: number;
  modifiedMs: number;
  testName?: string;
  runId?: string;
  passed?: number;
  failed?: number;
  total?: number;
  startedAt?: string;
}

function toSummary(s: BackendReportSummary): ReportSummary {
  return {
    name: s.name,
    size: s.size,
    modifiedMs: s.modified_ms,
    testName: s.test_name ?? undefined,
    runId: s.run_id ?? undefined,
    passed: s.passed ?? undefined,
    failed: s.failed ?? undefined,
    total: s.total ?? undefined,
    startedAt: s.started_at ?? undefined,
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
    /* */
  }
  throw new Error(message);
}

export async function listReports(): Promise<ReportSummary[]> {
  const resp = await fetch("/api/studio/reports");
  const list = await unwrap<BackendReportSummary[]>(resp);
  return list.map(toSummary);
}

export async function getReport(name: string): Promise<ReplayReport> {
  const resp = await fetch(`/api/studio/reports/${encodeURIComponent(name)}`);
  return unwrap<ReplayReport>(resp);
}

export async function saveReport(
  name: string,
  report: ReplayReport,
): Promise<ReportSummary> {
  const resp = await fetch(`/api/studio/reports/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  const summary = await unwrap<BackendReportSummary>(resp);
  return toSummary(summary);
}
