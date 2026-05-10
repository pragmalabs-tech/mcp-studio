import { describe, expect, it } from "vitest";
import { formatPath, parsePath, PathParseError, resolvePath } from "./paths";

describe("parsePath", () => {
  it("parses bare keys joined with dots", () => {
    expect(parsePath("a.b.c")).toEqual([
      { kind: "key", key: "a" },
      { kind: "key", key: "b" },
      { kind: "key", key: "c" },
    ]);
  });

  it("parses array indices", () => {
    expect(parsePath("a[0]")).toEqual([
      { kind: "key", key: "a" },
      { kind: "index", index: 0 },
    ]);
    expect(parsePath("a[3].b")).toEqual([
      { kind: "key", key: "a" },
      { kind: "index", index: 3 },
      { kind: "key", key: "b" },
    ]);
  });

  it("parses wildcards", () => {
    expect(parsePath("a[*]")).toEqual([
      { kind: "key", key: "a" },
      { kind: "wildcard" },
    ]);
    expect(parsePath("a[*].b")).toEqual([
      { kind: "key", key: "a" },
      { kind: "wildcard" },
      { kind: "key", key: "b" },
    ]);
  });

  it("parses bracketed string keys", () => {
    expect(parsePath('a["weird key"].b')).toEqual([
      { kind: "key", key: "a" },
      { kind: "key", key: "weird key" },
      { kind: "key", key: "b" },
    ]);
  });

  it("parses bracketed keys with escaped quotes", () => {
    expect(parsePath('["a\\"b"]')).toEqual([{ kind: "key", key: 'a"b' }]);
  });

  it("parses leading $ as the root marker", () => {
    expect(parsePath("$")).toEqual([{ kind: "root" }]);
    expect(parsePath("$.a")).toEqual([
      { kind: "root" },
      { kind: "key", key: "a" },
    ]);
  });

  it("rejects empty input", () => {
    expect(() => parsePath("")).toThrow(PathParseError);
  });

  it("rejects unterminated brackets", () => {
    expect(() => parsePath("a[0")).toThrow(PathParseError);
  });

  it("rejects garbage inside brackets", () => {
    expect(() => parsePath("a[oops]")).toThrow(PathParseError);
  });

  it("rejects double dots", () => {
    expect(() => parsePath("a..b")).toThrow(PathParseError);
  });
});

describe("resolvePath", () => {
  it("returns the value at a simple path", () => {
    const result = resolvePath({ a: { b: 1 } }, parsePath("a.b"));
    expect(result).toEqual({ values: [1], gathered: false });
  });

  it("returns array element by index", () => {
    const result = resolvePath({ a: [10, 20, 30] }, parsePath("a[1]"));
    expect(result).toEqual({ values: [20], gathered: false });
  });

  it("supports negative indices", () => {
    const result = resolvePath({ a: [10, 20, 30] }, parsePath("a[-1]"));
    expect(result).toEqual({ values: [30], gathered: false });
  });

  it("gathers via wildcard", () => {
    const result = resolvePath(
      { a: [{ b: 1 }, { b: 2 }, { b: 3 }] },
      parsePath("a[*].b"),
    );
    expect(result).toEqual({ values: [1, 2, 3], gathered: true });
  });

  it("returns empty values on miss", () => {
    const result = resolvePath({ a: 1 }, parsePath("a.b.c"));
    expect(result.values).toEqual([]);
  });

  it("returns empty values when wildcard target isn't an array", () => {
    const result = resolvePath({ a: 1 }, parsePath("a[*]"));
    expect(result.values).toEqual([]);
  });

  it("treats arrays as not-objects for key access", () => {
    const result = resolvePath({ a: [1, 2] }, parsePath("a.length"));
    expect(result.values).toEqual([]);
  });

  it("resolves $ as the root", () => {
    const result = resolvePath({ a: 1 }, parsePath("$"));
    expect(result).toEqual({ values: [{ a: 1 }], gathered: false });
  });

  it("resolves bracketed string keys", () => {
    const result = resolvePath({ "weird key": 42 }, parsePath('["weird key"]'));
    expect(result.values).toEqual([42]);
  });

  it("preserves null and false in matched values", () => {
    expect(resolvePath({ a: null }, parsePath("a")).values).toEqual([null]);
    expect(resolvePath({ a: false }, parsePath("a")).values).toEqual([false]);
  });
});

describe("formatPath", () => {
  it("round-trips a simple path", () => {
    const path = parsePath("a.b.c");
    expect(formatPath(path)).toBe("a.b.c");
  });

  it("formats indices and wildcards", () => {
    expect(formatPath(parsePath("a[0].b[*].c"))).toBe("a[0].b[*].c");
  });

  it("formats bracketed string keys", () => {
    expect(formatPath(parsePath('a["weird key"]'))).toBe('a["weird key"]');
  });

  it("formats root", () => {
    expect(formatPath([{ kind: "root" }])).toBe("$");
  });
});
