import { describe, expect, it } from "vitest";
import { runMatcher } from "./match";

function single(matcher: unknown, value: unknown) {
  return runMatcher(matcher, [value], false);
}

function many(matcher: unknown, values: unknown[]) {
  return runMatcher(matcher, values, true);
}

describe("literal matchers", () => {
  it("strict equality on scalars", () => {
    expect(single(42, 42).ok).toBe(true);
    expect(single("a", "a").ok).toBe(true);
    expect(single(true, true).ok).toBe(true);
    expect(single(null, null).ok).toBe(true);
  });

  it("rejects mismatched scalars", () => {
    const r = single(42, "42");
    expect(r.ok).toBe(false);
  });

  it("array literal compares deeply", () => {
    expect(single([1, 2, 3], [1, 2, 3]).ok).toBe(true);
    expect(single([1, 2], [1, 2, 3]).ok).toBe(false);
  });
});

describe("type matcher", () => {
  it("matches primitive types", () => {
    expect(single({ type: "string" }, "x").ok).toBe(true);
    expect(single({ type: "number" }, 42).ok).toBe(true);
    expect(single({ type: "boolean" }, true).ok).toBe(true);
    expect(single({ type: "null" }, null).ok).toBe(true);
    expect(single({ type: "array" }, [1]).ok).toBe(true);
    expect(single({ type: "object" }, { a: 1 }).ok).toBe(true);
  });

  it("arrays are not objects", () => {
    expect(single({ type: "object" }, [1]).ok).toBe(false);
  });
});

describe("exists matcher", () => {
  it("true when path resolved", () => {
    expect(runMatcher({ exists: true }, [42], false).ok).toBe(true);
  });

  it("false when path empty", () => {
    expect(runMatcher({ exists: true }, [], false).ok).toBe(false);
  });

  it("inverted false when path resolved", () => {
    expect(runMatcher({ exists: false }, [42], false).ok).toBe(false);
  });
});

describe("matches matcher (regex)", () => {
  it("hits when string matches", () => {
    expect(single({ matches: "^Tokyo" }, "Tokyo, Japan").ok).toBe(true);
  });
  it("misses when no match", () => {
    expect(single({ matches: "^Tokyo" }, "Berlin").ok).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(single({ matches: ".*" }, 42).ok).toBe(false);
  });
});

describe("contains matcher", () => {
  it("substring on string", () => {
    expect(single({ contains: "lo" }, "hello").ok).toBe(true);
    expect(single({ contains: "xyz" }, "hello").ok).toBe(false);
  });
  it("element includes on array", () => {
    expect(single({ contains: 2 }, [1, 2, 3]).ok).toBe(true);
    expect(single({ contains: { a: 1 } }, [{ a: 1 }, { b: 2 }]).ok).toBe(true);
    expect(single({ contains: 5 }, [1, 2, 3]).ok).toBe(false);
  });
});

describe("shape matcher", () => {
  it("subset deep match passes when keys present", () => {
    const r = single(
      { shape: { a: 1, b: { c: { type: "number" } } } },
      { a: 1, b: { c: 42, extra: "ignored" }, also: "ignored" },
    );
    expect(r.ok).toBe(true);
  });

  it("fails when a key is missing", () => {
    const r = single({ shape: { a: 1 } }, { b: 2 });
    expect(r.ok).toBe(false);
  });

  it("fails with path-style reason", () => {
    const r = single({ shape: { a: { b: 99 } } }, { a: { b: 1 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('"a"');
  });
});

describe("between / numeric matchers", () => {
  it("between passes inclusive", () => {
    expect(single({ between: [0, 100] }, 50).ok).toBe(true);
    expect(single({ between: [0, 100] }, 0).ok).toBe(true);
    expect(single({ between: [0, 100] }, 100).ok).toBe(true);
    expect(single({ between: [0, 100] }, 101).ok).toBe(false);
  });
  it("gte / lte / gt / lt", () => {
    expect(single({ gte: 5 }, 5).ok).toBe(true);
    expect(single({ gt: 5 }, 5).ok).toBe(false);
    expect(single({ lte: 5 }, 5).ok).toBe(true);
    expect(single({ lt: 5 }, 5).ok).toBe(false);
  });
});

describe("length matcher", () => {
  it("number form matches array length", () => {
    expect(single({ length: 3 }, [1, 2, 3]).ok).toBe(true);
    expect(single({ length: 3 }, "abc").ok).toBe(true);
  });
  it("nested matcher form", () => {
    expect(single({ length: { gte: 2 } }, [1, 2, 3]).ok).toBe(true);
    expect(single({ length: { gte: 5 } }, [1, 2, 3]).ok).toBe(false);
  });
});

describe("composition: all_of / any_of / not", () => {
  it("all_of requires every branch", () => {
    expect(single({ all_of: [{ type: "number" }, { gte: 0 }] }, 5).ok).toBe(
      true,
    );
    expect(single({ all_of: [{ type: "number" }, { gte: 0 }] }, -1).ok).toBe(
      false,
    );
  });
  it("any_of requires one branch", () => {
    expect(
      single({ any_of: [{ type: "string" }, { type: "number" }] }, 5).ok,
    ).toBe(true);
    expect(
      single({ any_of: [{ type: "string" }, { type: "boolean" }] }, 5).ok,
    ).toBe(false);
  });
  it("not inverts", () => {
    expect(single({ not: { type: "number" } }, "x").ok).toBe(true);
    expect(single({ not: { type: "number" } }, 5).ok).toBe(false);
  });
});

describe("wildcard semantics (gathered)", () => {
  it("shape-style matchers run per element", () => {
    const r = many({ type: "number" }, [1, 2, 3]);
    expect(r.ok).toBe(true);
  });
  it("any element failing fails the gather", () => {
    const r = many({ type: "number" }, [1, "two", 3]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("element[1]");
  });
  it("length runs against the gathered array", () => {
    const r = many({ length: 3 }, [1, 2, 3]);
    expect(r.ok).toBe(true);
  });
  it("contains runs against the gathered array", () => {
    const r = many({ contains: 2 }, [1, 2, 3]);
    expect(r.ok).toBe(true);
  });
});

describe("path miss handling", () => {
  it("non-exists matcher fails on empty values", () => {
    const r = runMatcher({ type: "number" }, [], false);
    expect(r.ok).toBe(false);
  });
  it("exists:false passes on empty values", () => {
    const r = runMatcher({ exists: false }, [], false);
    expect(r.ok).toBe(true);
  });
  it("not-matcher passes on empty values (absence != anything)", () => {
    // The implicit `result.isError != true` check fires for every mcp.call
    // but `isError` is absent on resources/read, prompts/get, etc. Absence
    // is success.
    const r = runMatcher({ not: true }, [], false);
    expect(r.ok).toBe(true);
  });
  it("any_of with exists:false branch passes on empty values", () => {
    const r = runMatcher(
      { any_of: [{ exists: false }, { type: "number" }] },
      [],
      false,
    );
    expect(r.ok).toBe(true);
  });
});
