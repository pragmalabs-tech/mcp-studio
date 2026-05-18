import { describe, expect, it } from "vitest";
import { computeStateChanges } from "./state-changes";

describe("computeStateChanges", () => {
  it("returns empty when values are identical", () => {
    expect(computeStateChanges({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
    expect(computeStateChanges(42, 42)).toEqual([]);
    expect(computeStateChanges(null, null)).toEqual([]);
  });

  it("reports a single changed leaf at its dot-path", () => {
    const changes = computeStateChanges({ a: { b: 1 } }, { a: { b: 2 } });
    expect(changes).toEqual([{ path: "a.b", before: 1, after: 2 }]);
  });

  it("walks nested objects to leaf level", () => {
    const changes = computeStateChanges(
      { tools: { foo: { callCount: 0, lastResult: undefined } } },
      { tools: { foo: { callCount: 1, lastResult: { id: "x" } } } },
    );
    expect(changes).toEqual([
      { path: "tools.foo.callCount", before: 0, after: 1 },
      {
        path: "tools.foo.lastResult",
        before: undefined,
        after: { id: "x" },
      },
    ]);
  });

  it("reports added and removed keys", () => {
    const changes = computeStateChanges({ a: 1 }, { a: 1, b: 2 });
    expect(changes).toEqual([{ path: "b", before: undefined, after: 2 }]);

    const removed = computeStateChanges({ a: 1, b: 2 }, { a: 1 });
    expect(removed).toEqual([{ path: "b", before: 2, after: undefined }]);
  });

  it("walks arrays index-by-index", () => {
    const changes = computeStateChanges({ xs: [1, 2, 3] }, { xs: [1, 9, 3] });
    expect(changes).toEqual([{ path: "xs[1]", before: 2, after: 9 }]);
  });

  it("reports array length changes as element add/remove", () => {
    const changes = computeStateChanges({ xs: [1, 2] }, { xs: [1, 2, 3, 4] });
    expect(changes).toEqual([
      { path: "xs[2]", before: undefined, after: 3 },
      { path: "xs[3]", before: undefined, after: 4 },
    ]);
  });

  it("reports type changes at the current path without descending", () => {
    const changes = computeStateChanges({ a: { b: 1 } }, { a: "string" });
    expect(changes).toEqual([{ path: "a", before: { b: 1 }, after: "string" }]);
  });

  it("treats null and object as distinct", () => {
    const changes = computeStateChanges({ a: null }, { a: { x: 1 } });
    expect(changes).toEqual([{ path: "a", before: null, after: { x: 1 } }]);
  });
});
