import type { RunResult, StepResult } from "./player";
import type { ReplayArtifacts } from "./artifacts";

export const REPORT_VERSION = 1 as const;

export interface ReplayReport {
  version: typeof REPORT_VERSION;
  runId: string;
  test: { name: string; description?: string; totalActions: number };
  summary: RunResult["summary"];
  preconditions: { strictModeOk: boolean; iframeReady: boolean };
  steps: StepResult[];
  artifacts: ReplayArtifacts;
  env: {
    userAgent: string;
    viewport: { w: number; h: number };
    studioVersion: string;
  };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface ReportInput {
  runResult: RunResult;
  artifacts: ReplayArtifacts;
  preconditions: { strictModeOk: boolean; iframeReady: boolean };
  env?: Partial<ReplayReport["env"]>;
}

export function buildReport(input: ReportInput): ReplayReport {
  const { runResult, artifacts, preconditions } = input;
  return {
    version: REPORT_VERSION,
    runId: uuid(),
    test: runResult.test,
    summary: runResult.summary,
    preconditions,
    steps: runResult.steps,
    artifacts,
    env: {
      userAgent:
        input.env?.userAgent ??
        (typeof navigator !== "undefined" ? navigator.userAgent : "unknown"),
      viewport:
        input.env?.viewport ??
        (typeof window !== "undefined"
          ? { w: window.innerWidth, h: window.innerHeight }
          : { w: 0, h: 0 }),
      studioVersion: input.env?.studioVersion ?? "0.1.0",
    },
    startedAt: runResult.startedAt,
    finishedAt: runResult.finishedAt,
    durationMs: runResult.durationMs,
  };
}

/** `<test-name>-<runId>.report.json` */
export function reportFilename(report: ReplayReport): string {
  const safe = report.test.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const stub = report.runId.slice(0, 8);
  return `${safe || "report"}-${stub}`;
}
