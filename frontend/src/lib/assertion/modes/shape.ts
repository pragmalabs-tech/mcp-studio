import toJsonSchema from "to-json-schema";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import isUUID from "validator/lib/isUUID";
import isISO8601 from "validator/lib/isISO8601";
import isJWT from "validator/lib/isJWT";
import type { AssertResult } from "../types";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addFormat("jwt", { type: "string", validate: (v: string) => isJWT(v) });

/**
 * Shape compare. Infers a JSON Schema from the recorded value, then
 * validates the live value against it. Leaf values that match a known
 * generated format (uuid, date-time, jwt, epoch) get a `format` annotation
 * so the live value must also match that format — not just the type.
 *
 * Uses `to-json-schema` (infer) + `ajv` + `ajv-formats` (validate).
 * Array inference uses element [0] as the template (homogeneous assumption).
 */
export function modeShape(recorded: unknown, actual: unknown): AssertResult {
  if (recorded === undefined) {
    return { status: "passed", data: { reason: "no recorded baseline" } };
  }
  const raw = toJsonSchema(recorded, {
    required: true,
    arrays: { mode: "first" },
  });
  const schema = annotateFormats(normalizeRequired(raw), recorded);
  const ok = ajv.validate(schema as object, actual);
  if (ok) return { status: "passed", data: { expected: recorded, actual } };
  return {
    status: "failed",
    data: {
      expected: recorded,
      actual,
      reason: ajv.errorsText(ajv.errors, { separator: "; " }),
    },
  };
}

/**
 * Walk the inferred schema in parallel with the recorded value and attach
 * `format` keywords where the value matches a known generated format.
 */
function annotateFormats(schema: unknown, value: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;

  if (s.type === "string" && typeof value === "string") {
    const fmt = stringFormat(value);
    if (fmt) return { ...s, format: fmt };
  }

  if (
    (s.type === "number" || s.type === "integer") &&
    typeof value === "number"
  ) {
    const constraint = numberConstraint(value);
    if (constraint) return { ...s, ...constraint };
  }

  if (
    s.type === "object" &&
    s.properties &&
    typeof value === "object" &&
    value !== null
  ) {
    const props = s.properties as Record<string, unknown>;
    const val = value as Record<string, unknown>;
    const newProps: Record<string, unknown> = {};
    for (const k of Object.keys(props)) {
      newProps[k] = annotateFormats(props[k], val[k]);
    }
    return { ...s, properties: newProps };
  }

  if (
    s.type === "array" &&
    s.items &&
    Array.isArray(value) &&
    value.length > 0
  ) {
    return { ...s, items: annotateFormats(s.items, value[0]) };
  }

  return schema;
}

function stringFormat(v: string): string | null {
  if (isUUID(v)) return "uuid";
  if (isISO8601(v)) return "date-time";
  if (isJWT(v)) return "jwt";
  return null;
}

function numberConstraint(v: number): Record<string, number> | null {
  if (v > 1e12 && v < 1e14) return { minimum: 1e12, maximum: 1e14 };
  if (v > 1e9 && v < 1e10) return { minimum: 1e9, maximum: 1e10 };
  return null;
}

/**
 * `to-json-schema` with `required: true` emits Draft-4-style `required: true`
 * directly on each property. Ajv (Draft 7+) wants a `required: [keys]` array
 * on the parent. Lift those into the standard form.
 */
function normalizeRequired(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  if (typeof out.required === "boolean") delete out.required;

  if (
    out.type === "object" &&
    out.properties &&
    typeof out.properties === "object"
  ) {
    const props = out.properties as Record<string, unknown>;
    const requiredKeys: string[] = [];
    const newProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (
        v &&
        typeof v === "object" &&
        (v as Record<string, unknown>).required === true
      ) {
        requiredKeys.push(k);
      }
      newProps[k] = normalizeRequired(v);
    }
    out.properties = newProps;
    if (requiredKeys.length) out.required = requiredKeys;
  } else if (out.type === "array" && out.items) {
    out.items = normalizeRequired(out.items);
  }
  return out;
}
