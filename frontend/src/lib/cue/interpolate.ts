/**
 * `{{ name }}` substitution for Cue. Walks any JSON value, replaces
 * placeholders in string fields with values from the Cue's scope. See
 * `cue-spec.md` §9.
 *
 * Scope precedence: `binds > fixtures > env`. A reference to `env.X` reads
 * from the env scope; `fixtures.X` reads from the fixtures scope; a bare
 * name reads `binds[name]` (the most recent `bind` capture for that name).
 *
 * Type coercion: when a string is **exactly** `{{ name }}` (no other
 * content), the value is substituted with its native type. Otherwise the
 * value is stringified and concatenated. So `{ id: "{{ uid }}" }` produces
 * `{ id: 42 }` (number) but `"hello {{ uid }}"` produces `"hello 42"`.
 *
 * Missing variables throw `InterpolationError` at the moment of evaluation
 * with the variable name in the message. The translator catches this at run
 * time so the failing step shows a clear reason in the report.
 */

export interface InterpolateScope {
  fixtures: Record<string, unknown>;
  binds: Record<string, unknown>;
  env: Record<string, string>;
}

export class InterpolationError extends Error {
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(message);
    this.name = "InterpolationError";
    this.variable = variable;
  }
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

function lookup(name: string, scope: InterpolateScope): unknown {
  // env.X — process / shell env
  if (name.startsWith("env.")) {
    const key = name.slice(4);
    if (Object.prototype.hasOwnProperty.call(scope.env, key)) {
      return scope.env[key];
    }
    throw new InterpolationError(name, `env variable "${key}" is not set`);
  }

  // fixtures.X — Cue's fixtures block
  if (name.startsWith("fixtures.")) {
    const key = name.slice(9);
    if (Object.prototype.hasOwnProperty.call(scope.fixtures, key)) {
      return scope.fixtures[key];
    }
    throw new InterpolationError(
      name,
      `fixture "${key}" not declared in this Cue`,
    );
  }

  // bare name — bound by an earlier action
  if (Object.prototype.hasOwnProperty.call(scope.binds, name)) {
    return scope.binds[name];
  }

  throw new InterpolationError(name, `variable "${name}" is not bound`);
}

/** Substitute `{{ X }}` placeholders inside a string. Single placeholders
 *  return the native value; mixed strings stringify and concatenate. */
function interpolateString(input: string, scope: InterpolateScope): unknown {
  PLACEHOLDER.lastIndex = 0;
  const trimmed = input.trim();
  const single = trimmed.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (single) {
    return lookup(single[1].trim(), scope);
  }
  return input.replace(PLACEHOLDER, (_match, raw: string) => {
    const value = lookup(raw.trim(), scope);
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  });
}

/** Walk any JSON value, substituting placeholders in strings. Arrays and
 *  objects are deep-copied; other primitives pass through unchanged. */
export function interpolate(value: unknown, scope: InterpolateScope): unknown {
  if (typeof value === "string") {
    if (!value.includes("{{")) return value;
    return interpolateString(value, scope);
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolate(v, scope));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolate(v, scope);
    }
    return out;
  }
  return value;
}
