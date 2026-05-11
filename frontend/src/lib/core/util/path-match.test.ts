import { describe, expect, it } from "vitest";
import { matchesAnyPattern } from "./path-match";

describe("matchesAnyPattern", () => {
  it("matches_literal_path", () => {
    expect(
      matchesAnyPattern("tools.weather.callCount", ["tools.weather.callCount"]),
    ).toBe(true);
    expect(
      matchesAnyPattern("tools.weather.callCount", ["tools.foo.callCount"]),
    ).toBe(false);
  });

  it("star_matches_any_object_key", () => {
    expect(
      matchesAnyPattern("tools.weather.lastResult", ["tools.*.lastResult"]),
    ).toBe(true);
    expect(
      matchesAnyPattern("tools.foo.lastResult", ["tools.*.lastResult"]),
    ).toBe(true);
  });

  it("star_does_not_cross_array_segment", () => {
    expect(matchesAnyPattern("widgets.open[3]", ["widgets.*"])).toBe(false);
  });

  it("bracket_star_matches_any_array_index", () => {
    expect(
      matchesAnyPattern("widgets.open[3].data", ["widgets.open[*].data"]),
    ).toBe(true);
  });

  it("matches_when_any_pattern_in_list_matches", () => {
    expect(
      matchesAnyPattern("tools.weather.lastResult.created_at", [
        "tools.*.lastResult.id",
        "tools.*.lastResult.created_at",
      ]),
    ).toBe(true);
  });

  it("rejects_on_length_mismatch", () => {
    expect(
      matchesAnyPattern("tools.weather.lastResult.id", ["tools.weather"]),
    ).toBe(false);
    expect(
      matchesAnyPattern("tools.weather", ["tools.weather.lastResult"]),
    ).toBe(false);
  });

  it("empty_patterns_returns_false", () => {
    expect(matchesAnyPattern("tools.weather", [])).toBe(false);
  });
});
