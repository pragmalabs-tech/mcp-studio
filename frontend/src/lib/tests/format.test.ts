import { describe, expect, it } from "vitest";
import { slugify } from "./format";

describe("slugify (mirror of backend safe_filename)", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Search Flow")).toBe("search-flow");
  });

  it("keeps existing dashes and underscores once", () => {
    expect(slugify("a---b___c")).toBe("a-b_c");
  });

  it("strips path traversal characters", () => {
    expect(slugify("../etc/passwd")).toBe("etcpasswd");
    expect(slugify("/abs")).toBe("abs");
  });

  it("trims trailing separators", () => {
    expect(slugify("---trim---")).toBe("trim");
  });

  it("falls back to untitled for empty / all-stripped input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("///")).toBe("untitled");
    expect(slugify("   ")).toBe("untitled");
  });

  it("caps length at 64 chars", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});
