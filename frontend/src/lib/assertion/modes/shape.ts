import toJsonSchema from "to-json-schema";
import Ajv from "ajv";
import type { AssertResult } from "../types";

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Shape compare. Infers a JSON Schema from the recorded value, then
 * validates the live value against it. Uses `to-json-schema` (infer) +
 * `ajv` (validate) so we don't hand-roll the structural walk.
 *
 * Note: schema inference treats observed values as required and arrays
 * as homogeneous (uses element [0] as the template). Both match how
 * MCP tool responses are shaped in practice.
 */
export function modeShape(recorded: unknown, actual: unknown): AssertResult {
  if (recorded === undefined) {
    return { status: "passed", data: { reason: "no recorded baseline" } };
  }
  const raw = toJsonSchema(recorded, {
    required: true,
    arrays: { mode: "first" },
  });
  const schema = normalizeRequired(raw);
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
 * `to-json-schema` with `required: true` emits Draft-4-style `required: true`
 * directly on each property. Ajv (Draft 7+) wants a `required: [keys]` array
 * on the parent. Lift those into the standard form.
 */
function normalizeRequired(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  // Strip the boolean shorthand at this level; the parent owns required-ness.
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
