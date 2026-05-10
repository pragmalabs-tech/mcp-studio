/**
 * Per-step assertion bundle the Cue → IR translator attaches to each
 * `Recorded` action via `_cue`. The engine's run loop calls
 * `evaluateBundle` after the driver returns and merges the result with the
 * driver's own `assertFor()` outcome.
 *
 * One bundle per step. Each bundle is a list of `CueAssertion` items
 * evaluated against the right substrate (action result, snapshot HTML,
 * recorder bus history). All entries must pass for the bundle to pass.
 */

import type { Locator, ExpectBlock, WaitCondition } from "./schema";
import { parsePath } from "./paths";
import { runMatcher } from "./match";
import { queryFind, queryText, queryVisible } from "./dom-query";
import type { Recorded } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";

export type CueAssertion =
  | { kind: "result_match"; expect: ExpectBlock }
  | {
      kind: "dom_text";
      target?: Locator;
      equals?: string;
      contains?: string;
      matches?: string;
    }
  | { kind: "dom_visible"; target: Locator }
  | {
      kind: "dom_wait";
      target?: Locator;
      condition: WaitCondition;
      timeoutMs: number;
    }
  | { kind: "no_runtime_errors" }
  | { kind: "no_csp_violations"; since: "cue_start" | "last_action" }
  | {
      kind: "triggers_mcp_call";
      method: string;
      match?: ExpectBlock;
      withinMs: number;
    }
  | {
      kind: "tool_response";
      method?: string;
      matchParams?: ExpectBlock;
      expect: ExpectBlock;
    }
  | {
      // Soft check: compares the rendered widget's snapshot HTML against
      // a snapshot captured at record time. Always returns ok:true; any
      // drift surfaces as a `warnings` entry on the bundle report and
      // ends up in the step's `info.warnings` for the report renderer.
      kind: "html_drift_warn";
      recordedHtml: string;
      tolerancePct: number;
    };

/**
 * `pre` runs before the driver dispatches; `post` runs after. v1 uses
 * `post` exclusively (every assertion is on observed state). `pre` is
 * reserved for future preconditions (e.g. "this tool must exist").
 */
export interface CueAssertionBundle {
  /** Short label for the report so users see what step is being asserted. */
  label?: string;
  pre?: CueAssertion[];
  post: CueAssertion[];
}

export interface CueAssertionFailure {
  index: number;
  kind: CueAssertion["kind"];
  reason: string;
}

export interface CueAssertionReport {
  ok: boolean;
  passed: number;
  failures: CueAssertionFailure[];
  /** Soft signals that don't fail the bundle (e.g. HTML drift). Surfaced
   *  in the report's `info.warnings` so users see them without the test
   *  going red. */
  warnings?: string[];
}

/** Per-step context the assertion runner consumes. The engine populates
 *  fields it has (`result` for mcp.* steps, `getSnapshot` for widget
 *  steps, `recentRequests` for triggers/tool_response). */
export interface AssertCtx {
  /** The driver's primary observation for this step (response value, ack,
   *  render result), used by `result_match` against `result.*` paths. */
  result?: unknown;
  /** Lazily fetch a snapshot HTML for DOM queries. Cached per step. */
  getSnapshot: () => Promise<string | null>;
  /** History of recorded actions during this run, used by `tool_response`
   *  and `triggers_mcp_call`. */
  history: Recorded[];
  /** Watermark in `history` at the start of this step's window. Used by
   *  `triggers_mcp_call` and `no_csp_violations.since=last_action`. */
  windowStart: number;
  /** Wait helper bound to the engine's abort signal. Returns true on
   *  success, false on timeout / abort. */
  waitFor: (
    predicate: () => Promise<boolean>,
    timeoutMs: number,
  ) => Promise<boolean>;
}

const PASS_REPORT: CueAssertionReport = { ok: true, passed: 0, failures: [] };

export async function evaluateBundle(
  bundle: CueAssertionBundle,
  ctx: AssertCtx,
): Promise<CueAssertionReport> {
  if (bundle.post.length === 0) return PASS_REPORT;
  const failures: CueAssertionFailure[] = [];
  const warnings: string[] = [];
  let passed = 0;
  for (let i = 0; i < bundle.post.length; i++) {
    const a = bundle.post[i];
    const r = await runOne(a, ctx);
    if (r.ok) {
      passed++;
      if (r.warn) warnings.push(r.warn);
    } else {
      failures.push({ index: i, kind: a.kind, reason: r.reason });
    }
  }
  const report: CueAssertionReport = {
    ok: failures.length === 0,
    passed,
    failures,
  };
  if (warnings.length > 0) report.warnings = warnings;
  return report;
}

/** Per-assertion result. `warn` carries a soft message that surfaces in
 *  the bundle's `warnings` array without failing the bundle. */
type RunOneResult = { ok: true; warn?: string } | { ok: false; reason: string };

async function runOne(a: CueAssertion, ctx: AssertCtx): Promise<RunOneResult> {
  switch (a.kind) {
    case "result_match":
      return runResultMatch(a.expect, ctx.result);

    case "dom_text": {
      const html = await ctx.getSnapshot();
      if (html === null) return { ok: false, reason: "no snapshot available" };
      const text = queryText(html, a.target);
      if (text === null) {
        return { ok: false, reason: "locator did not resolve" };
      }
      if (a.equals !== undefined && text !== a.equals) {
        return { ok: false, reason: `expected "${a.equals}", got "${text}"` };
      }
      if (a.contains !== undefined && !text.includes(a.contains)) {
        return { ok: false, reason: `text does not contain "${a.contains}"` };
      }
      if (a.matches !== undefined) {
        const re = new RegExp(a.matches);
        if (!re.test(text)) {
          return { ok: false, reason: `/${re.source}/ did not match` };
        }
      }
      return { ok: true };
    }

    case "dom_visible": {
      const html = await ctx.getSnapshot();
      if (html === null) return { ok: false, reason: "no snapshot available" };
      return queryVisible(html, a.target)
        ? { ok: true }
        : { ok: false, reason: "element not visible" };
    }

    case "dom_wait":
      return runDomWait(a, ctx);

    case "no_runtime_errors":
      return runNoRuntimeErrors(ctx);

    case "no_csp_violations":
      return runNoCspViolations(a.since, ctx);

    case "triggers_mcp_call":
      return runTriggersMcpCall(a, ctx);

    case "tool_response":
      return runToolResponse(a, ctx);

    case "html_drift_warn":
      return runHtmlDriftWarn(a, ctx);
  }
}

async function runHtmlDriftWarn(
  a: Extract<CueAssertion, { kind: "html_drift_warn" }>,
  ctx: AssertCtx,
): Promise<RunOneResult> {
  const html = await ctx.getSnapshot();
  if (html === null) return { ok: true };
  const recorded = a.recordedHtml.length;
  const observed = html.length;
  if (recorded === 0) return { ok: true };
  const diffPct = (Math.abs(observed - recorded) / recorded) * 100;
  if (diffPct <= a.tolerancePct) return { ok: true };
  return {
    ok: true,
    warn: `widget HTML drifted from recording (recorded ${recorded} chars, observed ${observed} chars, ${diffPct.toFixed(1)}% diff > ${a.tolerancePct}% tolerance)`,
  };
}

function runResultMatch(
  expect: ExpectBlock,
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  for (const [path, matcher] of Object.entries(expect)) {
    let parsed;
    try {
      parsed = parsePath(path);
    } catch (e) {
      return { ok: false, reason: `${path}: ${(e as Error).message}` };
    }
    const { values, gathered } = resolveImported(value, parsed);
    const r = runMatcher(matcher, values, gathered);
    if (!r.ok) {
      return { ok: false, reason: `${path}: ${r.reason}` };
    }
  }
  return { ok: true };
}

// Local shim so we don't need a circular import on paths.ts here.
function resolveImported(
  value: unknown,
  segments: ReturnType<typeof parsePath>,
) {
  // re-import via dynamic require would be wrong in ESM; use the same
  // resolver function via a normal import.
  return resolvePathLocal(value, segments);
}

import { resolvePath as resolvePathLocal } from "./paths";

async function runDomWait(
  a: Extract<CueAssertion, { kind: "dom_wait" }>,
  ctx: AssertCtx,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ok = await ctx.waitFor(async () => {
    const html = await ctx.getSnapshot();
    if (html === null) return false;
    return checkWaitCondition(html, a.target, a.condition);
  }, a.timeoutMs);
  return ok
    ? { ok: true }
    : {
        ok: false,
        reason: `wait_for ${conditionLabel(a.condition)} timed out after ${a.timeoutMs}ms`,
      };
}

function checkWaitCondition(
  html: string,
  target: Locator | undefined,
  condition: WaitCondition,
): boolean {
  if (condition.type === "visible") {
    if (!target) return false;
    return queryVisible(html, target);
  }
  if (condition.type === "hidden") {
    if (!target) return false;
    return !queryVisible(html, target);
  }
  if (condition.type === "text") {
    const text = queryText(html, target);
    if (text === null) return false;
    if (typeof condition.value === "string")
      return text.includes(condition.value);
    try {
      return new RegExp(condition.value.matches).test(text);
    } catch {
      return false;
    }
  }
  if (condition.type === "count") {
    if (!target) return false;
    // Count semantics need iterating selectors; v1 uses found/not-found
    // (treats N=1 as the only meaningful case). Promote when needed.
    const el = queryFind(html, target);
    const want = typeof condition.value === "number" ? condition.value : 1;
    return el ? want >= 1 : want === 0;
  }
  return false;
}

function conditionLabel(condition: WaitCondition): string {
  if (condition.type === "text") {
    return typeof condition.value === "string"
      ? `text "${condition.value}"`
      : `text /${condition.value.matches}/`;
  }
  return condition.type;
}

function runNoRuntimeErrors(
  ctx: AssertCtx,
): { ok: true } | { ok: false; reason: string } {
  // The bridge's render.complete carries `hasRuntimeErrors`. Walk the recent
  // history for any render.complete after the window started.
  for (let i = ctx.windowStart; i < ctx.history.length; i++) {
    const e = ctx.history[i];
    if (e.kind === "widget.render.complete" && e.hasRuntimeErrors) {
      return { ok: false, reason: "iframe reported runtime errors" };
    }
  }
  return { ok: true };
}

function runNoCspViolations(
  since: "cue_start" | "last_action",
  ctx: AssertCtx,
): { ok: true } | { ok: false; reason: string } {
  const start = since === "cue_start" ? 0 : ctx.windowStart;
  const violations: string[] = [];
  for (let i = start; i < ctx.history.length; i++) {
    const e = ctx.history[i];
    if (e.kind === "csp.violation") {
      violations.push(`${e.directive} blocked ${e.blockedUri}`);
    }
  }
  return violations.length === 0
    ? { ok: true }
    : {
        ok: false,
        reason: `CSP violations: ${violations.join("; ")}`,
      };
}

async function runTriggersMcpCall(
  a: Extract<CueAssertion, { kind: "triggers_mcp_call" }>,
  ctx: AssertCtx,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Wait until either a matching call appears in history or the window
  // expires. Polling on the bus history; the engine tops up history as
  // events arrive.
  const ok = await ctx.waitFor(async () => {
    return (
      findMatchingCall(ctx.history, ctx.windowStart, a.method, a.match) !== null
    );
  }, a.withinMs);
  return ok
    ? { ok: true }
    : {
        ok: false,
        reason: `no matching ${a.method} call within ${a.withinMs}ms`,
      };
}

function findMatchingCall(
  history: Recorded[],
  start: number,
  method: string,
  match: ExpectBlock | undefined,
): Recorded | null {
  for (let i = start; i < history.length; i++) {
    const e = history[i];
    if (e.kind !== KIND.MCP_REQUEST) continue;
    if (e.method !== method) continue;
    if (!match) return e;
    const r = runResultMatch(match, e);
    if (r.ok) return e;
  }
  return null;
}

function runToolResponse(
  a: Extract<CueAssertion, { kind: "tool_response" }>,
  ctx: AssertCtx,
): { ok: true } | { ok: false; reason: string } {
  // Walk history backwards, find the most recent matching mcp.request +
  // its mcp.response, run expect against the response result.
  let chosenRequest: Recorded | null = null;
  for (let i = ctx.history.length - 1; i >= 0; i--) {
    const e = ctx.history[i];
    if (e.kind !== KIND.MCP_REQUEST) continue;
    if (a.method && e.method !== a.method) continue;
    if (a.matchParams) {
      const r = runResultMatch(a.matchParams, e.params);
      if (!r.ok) continue;
    }
    chosenRequest = e;
    break;
  }
  if (!chosenRequest) {
    return { ok: false, reason: "no matching mcp.call in history" };
  }
  const requestId = (chosenRequest as { id?: number }).id;
  const response = ctx.history.find(
    (e) =>
      e.kind === KIND.MCP_RESPONSE &&
      (e as { requestId?: number }).requestId === requestId,
  );
  if (!response) {
    return { ok: false, reason: "matched call has no response yet" };
  }
  const result = (response as { result?: unknown; error?: { message: string } })
    .result;
  return runResultMatch(a.expect, result);
}
