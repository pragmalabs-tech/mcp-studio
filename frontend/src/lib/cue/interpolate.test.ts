import { describe, expect, it } from "vitest";
import { interpolate, InterpolationError } from "./interpolate";

const scope = {
  fixtures: { city: "Tokyo", count: 3 },
  binds: { session_id: "abc-123", user: { id: 42, email: "u@e" } },
  env: { API_KEY: "secret" },
};

describe("interpolate", () => {
  it("passes through plain strings", () => {
    expect(interpolate("hello", scope)).toBe("hello");
  });

  it("substitutes a bound variable", () => {
    expect(interpolate("{{ session_id }}", scope)).toBe("abc-123");
  });

  it("substitutes fixtures.X", () => {
    expect(interpolate("{{ fixtures.city }}", scope)).toBe("Tokyo");
  });

  it("substitutes env.X", () => {
    expect(interpolate("{{ env.API_KEY }}", scope)).toBe("secret");
  });

  it("preserves native type when string is exactly the placeholder", () => {
    expect(interpolate("{{ fixtures.count }}", scope)).toBe(3);
    expect(interpolate("{{ user }}", scope)).toEqual({
      id: 42,
      email: "u@e",
    });
  });

  it("stringifies and concatenates in mixed strings", () => {
    expect(interpolate("Hello {{ fixtures.city }}!", scope)).toBe(
      "Hello Tokyo!",
    );
    expect(interpolate("count={{ fixtures.count }}", scope)).toBe("count=3");
  });

  it("walks objects and arrays", () => {
    const result = interpolate(
      {
        path: "/users/{{ session_id }}",
        nested: ["{{ fixtures.city }}", { tag: "{{ env.API_KEY }}" }],
      },
      scope,
    );
    expect(result).toEqual({
      path: "/users/abc-123",
      nested: ["Tokyo", { tag: "secret" }],
    });
  });

  it("preserves non-string primitives", () => {
    expect(interpolate(42, scope)).toBe(42);
    expect(interpolate(true, scope)).toBe(true);
    expect(interpolate(null, scope)).toBe(null);
  });

  it("does not touch strings without placeholders", () => {
    const obj = { a: "no vars here", b: 42 };
    expect(interpolate(obj, scope)).toEqual(obj);
  });

  it("throws InterpolationError with the variable name when missing", () => {
    try {
      interpolate("{{ unknown_var }}", scope);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InterpolationError);
      expect((e as InterpolationError).message).toContain("unknown_var");
    }
  });

  it("throws when env var is missing", () => {
    expect(() => interpolate("{{ env.MISSING }}", scope)).toThrow(
      InterpolationError,
    );
  });

  it("bind overrides fixtures of the same name", () => {
    const overlap = {
      fixtures: { name: "fixture-value" },
      binds: { name: "bind-value" },
      env: {},
    };
    expect(interpolate("{{ name }}", overlap)).toBe("bind-value");
  });
});
