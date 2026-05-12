/**
 * Batch run result file schema. One JSON file per completed batch run,
 * stored at `~/.mcp-studio/run-results/<id>.json` by the backend.
 *
 * The file IS the report. It carries enough state (recorded + replayed
 * traces, verdict, environment fingerprint) to re-feed any past run back
 * into the engine or render its verdict via the existing trace viewer.
 */

import type { Trace, Verdict } from "@/lib/core/types";

export type RunResultStatus = "passed" | "failed" | "errored";

export interface RunResultEntry {
  testName: string;
  testFsName: string;
  status: RunResultStatus;
  durationMs: number;
  recorded: Trace;
  replayed: Trace;
  verdict: Verdict;
  /** Populated only when `status === "errored"`. */
  error?: string;
}

export interface RunEnv {
  proxyUrl: string;
  studioVersion: string;
  platform: "openai" | "claude";
  strict: boolean;
  profileId?: string;
  mcpServer?: { name: string; version: string };
}

export interface RunCounts {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  durationMs: number;
}

/** How the run was triggered. `standalone` = single test from Tests panel's
 *  Run button. `batch` = "Run all" on the filtered catalog. Files written
 *  before this field existed are treated as `batch` since "Run all" was
 *  the only persisted path. */
export type RunType = "standalone" | "batch";

export interface RunFile {
  id: string;
  runType: RunType;
  startedAt: number;
  finishedAt: number;
  filter: { tags: string[] };
  env: RunEnv;
  summary: RunCounts;
  results: RunResultEntry[];
}

/** Listing summary returned by `GET /api/studio/run-results`. Excludes
 *  the heavy `results[]` array. */
export interface RunFileSummary {
  id: string;
  size: number;
  modifiedMs: number;
  runType: RunType;
  startedAt?: number;
  finishedAt?: number;
  filter?: { tags: string[] };
  env?: RunEnv;
  summary?: RunCounts;
}

/** Sortable id derived from start time. The seconds-resolution timestamp
 *  + 4-char random suffix avoids collisions within a session and yields
 *  natural chronological sort when used as the filename. */
export function newRunId(now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts =
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "_" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds());
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rand}`;
}

/** Aggregate per-test entries into the run-level summary counts. */
export function summarize(entries: RunResultEntry[]): RunCounts {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let durationMs = 0;
  for (const e of entries) {
    durationMs += e.durationMs;
    if (e.status === "passed") passed++;
    else if (e.status === "failed") failed++;
    else errored++;
  }
  return { total: entries.length, passed, failed, errored, durationMs };
}
