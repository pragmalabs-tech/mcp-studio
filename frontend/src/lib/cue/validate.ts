/**
 * Hand-rolled structural validation for Cue files. Returns a tagged result
 * with all errors collected (not just the first), each carrying a JSON
 * Pointer path so the user can find the offending field. The validator is
 * also the format discriminator: a malformed file fails here with a clear
 * reason rather than slipping into the engine.
 *
 * No external JSON Schema runtime dependency in v1. JSON Schema emission
 * for IDE / agent ergonomics is a v2 deliverable.
 */

import type {
  Cue,
  CueStep,
  CueStepKind,
  ExpectBlock,
  Locator,
  WaitCondition,
  WidgetExpectEntry,
} from "./schema";
import { CUE_STEP_KINDS } from "./schema";
import { parsePath, PathParseError } from "./paths";

export interface ValidationError {
  path: string; // JSON Pointer (RFC 6901-ish)
  message: string;
}

export type ValidationResult =
  | { ok: true; cue: Cue }
  | { ok: false; errors: ValidationError[] };

const STEP_KIND_SET: ReadonlySet<string> = new Set(CUE_STEP_KINDS);

const LOCATOR_KEY_SET: ReadonlySet<string> = new Set([
  "text",
  "role",
  "label",
  "placeholder",
  "testid",
  "alt",
  "title",
  "css",
  "chain",
]);

const WIDGET_EXPECT_KIND_SET: ReadonlySet<string> = new Set([
  "text",
  "visible",
  "no_runtime_errors",
  "no_csp_violations",
  "triggers_mcp_call",
  "html_drift_warn",
]);

const WAIT_TYPE_SET: ReadonlySet<string> = new Set([
  "visible",
  "hidden",
  "text",
  "count",
]);

class Ctx {
  errors: ValidationError[] = [];
  add(path: string, message: string): void {
    this.errors.push({ path, message });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateCue(input: unknown): ValidationResult {
  const ctx = new Ctx();

  if (!isObject(input)) {
    ctx.add("", "Cue must be a JSON object");
    return { ok: false, errors: ctx.errors };
  }

  if (typeof input.id !== "string" || input.id.length === 0) {
    ctx.add("/id", "missing or empty `id` (string)");
  }
  if (typeof input.name !== "string" || input.name.length === 0) {
    ctx.add("/name", "missing or empty `name` (string)");
  }
  if (
    "description" in input &&
    input.description !== undefined &&
    typeof input.description !== "string"
  ) {
    ctx.add("/description", "must be a string when present");
  }

  if ("setup" in input && input.setup !== undefined) {
    validateSetup(input.setup, "/setup", ctx);
  }

  if ("fixtures" in input && input.fixtures !== undefined) {
    if (!isObject(input.fixtures)) {
      ctx.add("/fixtures", "must be an object when present");
    }
  }

  if (!Array.isArray(input.steps)) {
    ctx.add("/steps", "missing or invalid `steps` (must be an array)");
  } else if (input.steps.length === 0) {
    ctx.add("/steps", "must contain at least one step");
  } else {
    for (let i = 0; i < input.steps.length; i++) {
      validateStep(input.steps[i], `/steps/${i}`, ctx);
    }
  }

  // Reject unknown top-level keys; catches typos like `step` vs `steps`.
  const allowedTopKeys = new Set([
    "id",
    "name",
    "description",
    "setup",
    "fixtures",
    "steps",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedTopKeys.has(key)) {
      ctx.add(`/${key}`, `unknown top-level field "${key}"`);
    }
  }

  if (ctx.errors.length > 0) {
    return { ok: false, errors: ctx.errors };
  }
  return { ok: true, cue: input as unknown as Cue };
}

function validateSetup(value: unknown, path: string, ctx: Ctx): void {
  if (!isObject(value)) {
    ctx.add(path, "must be an object");
    return;
  }
  if ("profile" in value && typeof value.profile !== "string") {
    ctx.add(`${path}/profile`, "must be a string when present");
  }
  if ("requires" in value && value.requires !== undefined) {
    if (!isObject(value.requires)) {
      ctx.add(`${path}/requires`, "must be an object");
    } else {
      const r = value.requires;
      if ("tools" in r && r.tools !== undefined && !isStringArray(r.tools)) {
        ctx.add(`${path}/requires/tools`, "must be an array of strings");
      }
      if (
        "resources" in r &&
        r.resources !== undefined &&
        !isStringArray(r.resources)
      ) {
        ctx.add(`${path}/requires/resources`, "must be an array of strings");
      }
    }
  }
}

function validateStep(value: unknown, path: string, ctx: Ctx): void {
  if (!isObject(value)) {
    ctx.add(path, "step must be an object");
    return;
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !STEP_KIND_SET.has(kind)) {
    ctx.add(`${path}/kind`, `unknown step kind "${String(kind)}"`);
    return;
  }
  switch (kind as CueStepKind) {
    case "mcp.call":
      validateMcpCall(value, path, ctx);
      break;
    case "mcp.notify":
      validateMcpNotify(value, path, ctx);
      break;
    case "mcp.expect":
      validateMcpExpect(value, path, ctx);
      break;
    case "widget.open":
      validateWidgetOpen(value, path, ctx);
      break;
    case "widget.click":
      validateWidgetClick(value, path, ctx);
      break;
    case "widget.fill":
      validateWidgetFill(value, path, ctx);
      break;
    case "widget.wait_for":
      validateWidgetWaitFor(value, path, ctx);
      break;
    case "widget.expect":
      validateWidgetExpectStep(value, path, ctx);
      break;
    case "assert.tool_response":
      validateAssertToolResponse(value, path, ctx);
      break;
    case "flow.wait":
      if (typeof value.ms !== "number" || value.ms < 0) {
        ctx.add(`${path}/ms`, "must be a non-negative number");
      }
      break;
    case "flow.comment":
      if (typeof value.text !== "string") {
        ctx.add(`${path}/text`, "must be a string");
      }
      break;
  }
}

function validateMcpCall(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if (typeof value.method !== "string" || value.method.length === 0) {
    ctx.add(`${path}/method`, "missing or empty `method` (string)");
  }
  if ("expect" in value && value.expect !== undefined) {
    validateExpectBlock(value.expect, `${path}/expect`, ctx);
  }
  if ("bind" in value && value.bind !== undefined) {
    validateBind(value.bind, `${path}/bind`, ctx);
  }
  if (
    "timeout_ms" in value &&
    value.timeout_ms !== undefined &&
    (typeof value.timeout_ms !== "number" || value.timeout_ms <= 0)
  ) {
    ctx.add(`${path}/timeout_ms`, "must be a positive number");
  }
}

function validateMcpNotify(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if (typeof value.method !== "string" || value.method.length === 0) {
    ctx.add(`${path}/method`, "missing or empty `method` (string)");
  }
}

function validateMcpExpect(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if (value.type !== "request" && value.type !== "notification") {
    ctx.add(`${path}/type`, 'must be "request" or "notification"');
  }
  if (typeof value.method !== "string" || value.method.length === 0) {
    ctx.add(`${path}/method`, "missing or empty `method` (string)");
  }
  if ("match" in value && value.match !== undefined) {
    validateExpectBlock(value.match, `${path}/match`, ctx);
  }
  if ("respond" in value && value.respond !== undefined) {
    if (value.type !== "request") {
      ctx.add(
        `${path}/respond`,
        '`respond` is only valid when type === "request"',
      );
    }
  }
  if ("bind" in value && value.bind !== undefined) {
    validateBind(value.bind, `${path}/bind`, ctx);
  }
}

function validateWidgetOpen(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if (typeof value.tool !== "string" || value.tool.length === 0) {
    ctx.add(`${path}/tool`, "missing or empty `tool` (string)");
  }
  if ("expect" in value && value.expect !== undefined) {
    validateExpectBlock(value.expect, `${path}/expect`, ctx);
  }
  if ("bind" in value && value.bind !== undefined) {
    validateBind(value.bind, `${path}/bind`, ctx);
  }
}

function validateWidgetClick(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if (!("target" in value)) {
    ctx.add(`${path}/target`, "missing `target` (Locator)");
  } else {
    validateLocator(value.target, `${path}/target`, ctx);
  }
  if ("expect" in value && value.expect !== undefined) {
    validateWidgetExpectField(value.expect, `${path}/expect`, ctx);
  }
}

function validateWidgetFill(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if (!("target" in value)) {
    ctx.add(`${path}/target`, "missing `target` (Locator)");
  } else {
    validateLocator(value.target, `${path}/target`, ctx);
  }
  if (typeof value.value !== "string") {
    ctx.add(`${path}/value`, "must be a string");
  }
}

function validateWidgetWaitFor(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if ("target" in value && value.target !== undefined) {
    validateLocator(value.target, `${path}/target`, ctx);
  }
  if (!("condition" in value)) {
    ctx.add(`${path}/condition`, "missing `condition`");
  } else {
    validateWaitCondition(value.condition, `${path}/condition`, ctx);
  }
}

function validateWaitCondition(value: unknown, path: string, ctx: Ctx): void {
  if (!isObject(value)) {
    ctx.add(path, "must be an object");
    return;
  }
  const t = value.type;
  if (typeof t !== "string" || !WAIT_TYPE_SET.has(t)) {
    ctx.add(
      `${path}/type`,
      `must be one of visible/hidden/text/count, got "${String(t)}"`,
    );
    return;
  }
  if (t === "text") {
    const v = (value as { value?: unknown }).value;
    if (
      typeof v !== "string" &&
      !(isObject(v) && typeof v.matches === "string")
    ) {
      ctx.add(`${path}/value`, 'must be a string or { matches: "regex" }');
    }
  }
}

function validateWidgetExpectStep(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if (!("expect" in value)) {
    ctx.add(`${path}/expect`, "missing `expect`");
  } else {
    validateWidgetExpectField(value.expect, `${path}/expect`, ctx);
  }
}

function validateWidgetExpectField(
  value: unknown,
  path: string,
  ctx: Ctx,
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      validateWidgetExpectEntry(value[i], `${path}/${i}`, ctx);
    }
  } else {
    validateWidgetExpectEntry(value, path, ctx);
  }
}

function validateWidgetExpectEntry(
  value: unknown,
  path: string,
  ctx: Ctx,
): void {
  if (!isObject(value)) {
    ctx.add(path, "WidgetExpect entry must be an object");
    return;
  }
  const k = value.kind;
  if (typeof k !== "string" || !WIDGET_EXPECT_KIND_SET.has(k)) {
    ctx.add(`${path}/kind`, `unknown widget.expect kind "${String(k)}"`);
    return;
  }
  if (k === "text") {
    if ("target" in value && value.target !== undefined) {
      validateLocator(value.target, `${path}/target`, ctx);
    }
    const hasMatcher =
      typeof (value as { equals?: unknown }).equals === "string" ||
      typeof (value as { contains?: unknown }).contains === "string" ||
      typeof (value as { matches?: unknown }).matches === "string";
    if (!hasMatcher) {
      ctx.add(
        path,
        "text expect must include one of `equals`, `contains`, or `matches`",
      );
    }
  } else if (k === "visible") {
    if (!("target" in value)) {
      ctx.add(`${path}/target`, "missing `target` (Locator)");
    } else {
      validateLocator(
        (value as { target: unknown }).target,
        `${path}/target`,
        ctx,
      );
    }
  } else if (k === "no_csp_violations") {
    const since = (value as { since?: unknown }).since;
    if (
      since !== undefined &&
      since !== "cue_start" &&
      since !== "last_action"
    ) {
      ctx.add(
        `${path}/since`,
        'must be "cue_start" or "last_action" when present',
      );
    }
  } else if (k === "triggers_mcp_call") {
    if (typeof (value as { method?: unknown }).method !== "string") {
      ctx.add(`${path}/method`, "must be a string");
    }
    const within = (value as { within_ms?: unknown }).within_ms;
    if (within !== undefined && (typeof within !== "number" || within <= 0)) {
      ctx.add(`${path}/within_ms`, "must be a positive number");
    }
    if (
      "match" in value &&
      (value as { match?: unknown }).match !== undefined
    ) {
      validateExpectBlock(
        (value as { match: unknown }).match,
        `${path}/match`,
        ctx,
      );
    }
  } else if (k === "html_drift_warn") {
    if (
      typeof (value as { recorded_html?: unknown }).recorded_html !== "string"
    ) {
      ctx.add(
        `${path}/recorded_html`,
        "must be a string (recorded widget HTML)",
      );
    }
    const tol = (value as { tolerance_pct?: unknown }).tolerance_pct;
    if (
      tol !== undefined &&
      (typeof tol !== "number" || tol < 0 || tol > 100)
    ) {
      ctx.add(`${path}/tolerance_pct`, "must be a number 0-100");
    }
  }
}

function validateAssertToolResponse(
  value: Record<string, unknown>,
  path: string,
  ctx: Ctx,
): void {
  if (!("expect" in value)) {
    ctx.add(`${path}/expect`, "missing `expect`");
  } else {
    validateExpectBlock(value.expect, `${path}/expect`, ctx);
  }
  if (
    "method" in value &&
    value.method !== undefined &&
    typeof value.method !== "string"
  ) {
    ctx.add(`${path}/method`, "must be a string when present");
  }
  if ("match_params" in value && value.match_params !== undefined) {
    validateExpectBlock(value.match_params, `${path}/match_params`, ctx);
  }
}

function validateExpectBlock(value: unknown, path: string, ctx: Ctx): void {
  if (!isObject(value)) {
    ctx.add(path, "expect block must be an object keyed by paths");
    return;
  }
  for (const key of Object.keys(value)) {
    try {
      parsePath(key);
    } catch (e) {
      const msg = e instanceof PathParseError ? e.message : String(e);
      ctx.add(`${path}/${escapePointer(key)}`, msg);
    }
  }
}

function validateBind(value: unknown, path: string, ctx: Ctx): void {
  if (!isObject(value)) {
    ctx.add(path, 'bind must be an object: { var_name: "path" }');
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      ctx.add(
        `${path}/${escapePointer(k)}`,
        "bind value must be a path string",
      );
      continue;
    }
    try {
      parsePath(v);
    } catch (e) {
      const msg = e instanceof PathParseError ? e.message : String(e);
      ctx.add(`${path}/${escapePointer(k)}`, msg);
    }
  }
}

function validateLocator(value: unknown, path: string, ctx: Ctx): void {
  if (!isObject(value)) {
    ctx.add(path, "Locator must be an object");
    return;
  }
  const knownKeys = Object.keys(value).filter((k) => LOCATOR_KEY_SET.has(k));
  if (knownKeys.length === 0) {
    ctx.add(
      path,
      "Locator must use one of text/role/label/placeholder/testid/alt/title/css/chain",
    );
    return;
  }
  if ("chain" in value) {
    if (!Array.isArray(value.chain)) {
      ctx.add(`${path}/chain`, "must be an array of Locators");
    } else {
      for (let i = 0; i < value.chain.length; i++) {
        validateLocator(value.chain[i], `${path}/chain/${i}`, ctx);
      }
    }
  }
  if ("text" in value && typeof value.text !== "string") {
    ctx.add(`${path}/text`, "must be a string");
  }
  if ("role" in value && typeof value.role !== "string") {
    ctx.add(`${path}/role`, "must be a string");
  }
  if ("name" in value && value.name !== undefined) {
    const n = value.name;
    if (
      typeof n !== "string" &&
      !(isObject(n) && typeof n.matches === "string")
    ) {
      ctx.add(`${path}/name`, 'must be a string or { matches: "regex" }');
    }
  }
  for (const k of ["label", "placeholder", "testid", "alt", "title", "css"]) {
    if (
      k in value &&
      typeof (value as Record<string, unknown>)[k] !== "string"
    ) {
      ctx.add(`${path}/${k}`, "must be a string");
    }
  }
}

function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `  ${e.path || "<root>"}: ${e.message}`).join("\n");
}

// Re-export referenced types so callers don't have to dig.
export type {
  Cue,
  CueStep,
  Locator,
  ExpectBlock,
  WaitCondition,
  WidgetExpectEntry,
};
