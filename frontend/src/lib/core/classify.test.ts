import { describe, expect, it } from "vitest";
import { classify } from "./classify";

describe("classify", () => {
  it("iso8601_both_sides_match", () => {
    const c = classify("2026-05-11T12:34:36Z", "2026-05-11T12:35:09Z");
    expect(c?.kind).toBe("iso8601");
    expect(c?.suggested).toEqual({ match: "@iso8601" });
    expect(c?.sensitive).toBe(false);
  });

  it("iso8601_does_not_fire_when_one_side_is_not_iso", () => {
    expect(classify("2026-05-11T12:34:36Z", "May 11")).toBeNull();
  });

  it("uuid_both_sides_match", () => {
    const c = classify(
      "f68595d7-7a31-4a95-bf5d-de33f8ef7da2",
      "cb745332-293c-4ee5-813c-9e88df488f33",
    );
    expect(c?.kind).toBe("uuid");
    expect(c?.suggested).toEqual({ match: "@uuid" });
  });

  it("uuid_does_not_fire_for_non_uuid", () => {
    expect(classify("abc", "def")).toBeNull();
  });

  it("epoch_seconds_within_window", () => {
    const c = classify(1776783419, 1776783519);
    expect(c?.kind).toBe("epoch");
    expect(c?.suggested).toEqual({ match: "@epoch" });
  });

  it("epoch_does_not_fire_outside_90_days", () => {
    expect(classify(1_000_000_000, 1_500_000_000)).toBeNull();
  });

  it("epoch_does_not_fire_for_floats", () => {
    expect(classify(1.5, 2.5)).toBeNull();
  });

  it("jwt_both_sides_match_marks_sensitive_with_ignore", () => {
    const a = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-_DEF123";
    const b = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIyIn0.xyz-_GHI456";
    const c = classify(a, b);
    expect(c?.kind).toBe("jwt");
    expect(c?.sensitive).toBe(true);
    expect(c?.suggested).toEqual({ ignore: true });
  });

  it("aws_access_key_marks_sensitive", () => {
    const c = classify("AKIAIOSFODNN7EXAMPLE", "AKIAI44QH8DHBEXAMPLE");
    expect(c?.kind).toBe("aws_key");
    expect(c?.sensitive).toBe(true);
  });

  it("stripe_key_marks_sensitive", () => {
    const c = classify("sk_test_abc123", "sk_test_xyz789");
    expect(c?.kind).toBe("stripe_key");
    expect(c?.sensitive).toBe(true);
  });

  it("high_entropy_both_sides_match", () => {
    const a = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
    const b = "z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2";
    const c = classify(a, b);
    expect(c?.kind).toBe("high_entropy");
    expect(c?.sensitive).toBe(true);
    expect(c?.suggested).toEqual({ ignore: true });
  });

  it("high_entropy_does_not_fire_for_short_strings", () => {
    expect(classify("short1", "short2")).toBeNull();
  });

  it("returns_null_for_dissimilar_shapes", () => {
    expect(classify(42, "hello")).toBeNull();
    expect(classify(null, undefined)).toBeNull();
    expect(classify({ a: 1 }, { a: 2 })).toBeNull();
  });
});
