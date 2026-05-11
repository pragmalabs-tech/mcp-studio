import { describe, expect, it } from "vitest";
import {
  addIgnore,
  checkMatcher,
  findIgnore,
  findMatch,
  removeRule,
  resolveRules,
  setMatch,
} from "./rules";
import { makeTrace } from "./__tests__/fixtures";
import type { ResolvedRules } from "./types";

describe("checkMatcher", () => {
  it("any_accepts_defined_values", () => {
    expect(checkMatcher("@any", "x")).toBe(true);
    expect(checkMatcher("@any", 0)).toBe(true);
    expect(checkMatcher("@any", null)).toBe(true);
    expect(checkMatcher("@any", undefined)).toBe(false);
  });

  it("iso8601_accepts_standard_datetimes", () => {
    expect(checkMatcher("@iso8601", "2026-05-11T12:34:36Z")).toBe(true);
    expect(checkMatcher("@iso8601", "2026-05-11T12:34:36.123Z")).toBe(true);
    expect(checkMatcher("@iso8601", "2026-05-11T12:34:36+00:00")).toBe(true);
  });

  it("iso8601_rejects_non_datetime", () => {
    expect(checkMatcher("@iso8601", "May 11, 2026")).toBe(false);
    expect(checkMatcher("@iso8601", "2026-05-11")).toBe(false);
    expect(checkMatcher("@iso8601", 1776783419)).toBe(false);
  });

  it("uuid_matches_v4_and_other_versions", () => {
    expect(checkMatcher("@uuid", "f68595d7-7a31-4a95-bf5d-de33f8ef7da2")).toBe(
      true,
    );
    expect(checkMatcher("@uuid", "not-a-uuid")).toBe(false);
  });

  it("epoch_accepts_seconds_and_ms_integers", () => {
    expect(checkMatcher("@epoch", 1776783419)).toBe(true);
    expect(checkMatcher("@epoch", 1776783419123)).toBe(true);
    expect(checkMatcher("@epoch", 1.5)).toBe(false);
    expect(checkMatcher("@epoch", "1776783419")).toBe(false);
  });

  it("regex_matcher_validates_against_pattern", () => {
    expect(checkMatcher({ regex: "^req_[a-z0-9]+$" }, "req_abc123")).toBe(true);
    expect(checkMatcher({ regex: "^req_[a-z0-9]+$" }, "REQ_abc")).toBe(false);
  });

  it("regex_with_invalid_pattern_returns_false", () => {
    expect(checkMatcher({ regex: "[" }, "anything")).toBe(false);
  });
});

describe("resolveRules", () => {
  it("includes_builtin_layers_with_no_trace_rules", () => {
    const trace = makeTrace({ steps: [] });
    const r = resolveRules(trace);
    expect(r.ignore.every((e) => e.layer === "builtin.ignore")).toBe(true);
    expect(r.match.every((e) => e.layer === "builtin.match")).toBe(true);
  });

  it("trace_rules_appended_after_builtins", () => {
    const trace = makeTrace({ steps: [] });
    trace.rules = {
      ignore: ["custom.path"],
      match: { "another.path": "@uuid" },
    };
    const r = resolveRules(trace);
    const lastIgnore = r.ignore[r.ignore.length - 1];
    const lastMatch = r.match[r.match.length - 1];
    expect(lastIgnore).toEqual({
      pattern: "custom.path",
      layer: "trace.ignore",
    });
    expect(lastMatch).toEqual({
      pattern: "another.path",
      matcher: "@uuid",
      layer: "trace.match",
    });
  });
});

describe("findMatch", () => {
  it("returns_null_when_no_pattern_matches", () => {
    const list: ResolvedRules["match"] = [
      { pattern: "x.y", matcher: "@any", layer: "trace.match" },
    ];
    expect(findMatch("a.b", list)).toBeNull();
  });

  it("trace_match_overrides_builtin_match_for_same_path", () => {
    const list: ResolvedRules["match"] = [
      { pattern: "x.y", matcher: "@iso8601", layer: "builtin.match" },
      { pattern: "x.y", matcher: "@any", layer: "trace.match" },
    ];
    const winner = findMatch("x.y", list);
    expect(winner?.matcher).toBe("@any");
    expect(winner?.layer).toBe("trace.match");
  });
});

describe("findIgnore", () => {
  it("returns_first_matching_entry", () => {
    const list: ResolvedRules["ignore"] = [
      { pattern: "x.y", layer: "builtin.ignore" },
      { pattern: "x.y", layer: "trace.ignore" },
    ];
    expect(findIgnore("x.y", list)?.layer).toBe("builtin.ignore");
  });

  it("returns_null_when_no_pattern_matches", () => {
    expect(findIgnore("a.b", [])).toBeNull();
  });
});

describe("rule mutators", () => {
  it("addIgnore_dedupes", () => {
    const next = addIgnore({ ignore: ["a"] }, "a");
    expect(next.ignore).toEqual(["a"]);
  });

  it("addIgnore_appends_new_path", () => {
    const next = addIgnore({ ignore: ["a"] }, "b");
    expect(next.ignore).toEqual(["a", "b"]);
  });

  it("setMatch_overwrites_existing_path", () => {
    const next = setMatch({ match: { "x.y": "@any" } }, "x.y", "@iso8601");
    expect(next.match).toEqual({ "x.y": "@iso8601" });
  });

  it("removeRule_strips_from_both_collections", () => {
    const next = removeRule(
      { ignore: ["a", "b"], match: { a: "@any", c: "@uuid" } },
      "a",
    );
    expect(next.ignore).toEqual(["b"]);
    expect(next.match).toEqual({ c: "@uuid" });
  });
});
