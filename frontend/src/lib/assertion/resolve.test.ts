import { describe, it, expect } from "vitest";
import { resolveResultModes, resolveStateMode } from "./resolve";
import type { AssertablePoint, TestAssertionConfig } from "./types";

const points: AssertablePoint[] = [
  {
    key: "success",
    label: "Success",
    path: "success",
    defaultMode: "exact",
    supportedModes: ["exact", "ignore"],
  },
  {
    key: "content",
    label: "Content",
    path: "data.content",
    defaultMode: "ignore",
    supportedModes: ["exact", "shape", "flaky", "ignore"],
  },
];

describe("resolveResultModes", () => {
  it("uses point defaults when no config", () => {
    expect(resolveResultModes(undefined, "a", points)).toEqual({
      success: "exact",
      content: "ignore",
    });
  });

  it("override wins over default", () => {
    const cfg: TestAssertionConfig = {
      perAction: { a: { result: { content: "flaky" } } },
    };
    expect(resolveResultModes(cfg, "a", points)).toEqual({
      success: "exact",
      content: "flaky",
    });
  });

  it("config for a different action does not leak", () => {
    const cfg: TestAssertionConfig = {
      perAction: { b: { result: { content: "flaky" } } },
    };
    expect(resolveResultModes(cfg, "a", points).content).toBe("ignore");
  });
});

describe("resolveStateMode", () => {
  it("falls back to 'exact' when nothing set", () => {
    expect(resolveStateMode(undefined, "a")).toBe("exact");
  });

  it("uses defaults.state when no perAction override", () => {
    expect(resolveStateMode({ defaults: { state: "shape" } }, "a")).toBe(
      "shape",
    );
  });

  it("perAction beats defaults", () => {
    expect(
      resolveStateMode(
        {
          defaults: { state: "shape" },
          perAction: { a: { state: "ignore" } },
        },
        "a",
      ),
    ).toBe("ignore");
  });
});
