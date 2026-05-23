import { describe, it, expect } from "vitest";
import { modeExact, deepEqual } from "./exact";

describe("modeExact", () => {
  it("passes on identical primitives", () => {
    expect(modeExact(1, 1).status).toBe("passed");
    expect(modeExact("a", "a").status).toBe("passed");
    expect(modeExact(true, true).status).toBe("passed");
    expect(modeExact(null, null).status).toBe("passed");
  });

  it("passes on deeply equal objects", () => {
    expect(
      modeExact({ a: 1, b: [2, { c: 3 }] }, { a: 1, b: [2, { c: 3 }] }).status,
    ).toBe("passed");
  });

  it("fails on differing primitives", () => {
    const r = modeExact(1, 2);
    expect(r.status).toBe("failed");
    expect(r.data.reason).toBe("exact mismatch");
  });

  it("fails on differing nested values", () => {
    expect(modeExact({ a: 1 }, { a: 2 }).status).toBe("failed");
  });

  it("fails on differing keys", () => {
    expect(modeExact({ a: 1 }, { b: 1 }).status).toBe("failed");
  });

  it("fails on array length mismatch", () => {
    expect(modeExact([1, 2], [1, 2, 3]).status).toBe("failed");
  });

  it("treats null vs object as not equal", () => {
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({}, null)).toBe(false);
  });
});
