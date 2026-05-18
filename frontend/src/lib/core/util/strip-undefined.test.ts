import { describe, expect, it } from "vitest";
import { stripUndefined } from "./strip-undefined";

describe("stripUndefined", () => {
  it("drops top-level undefined-valued keys", () => {
    expect(stripUndefined({ a: 1, b: undefined, c: "x" })).toEqual({
      a: 1,
      c: "x",
    });
  });

  it("preserves keys with null, false, 0, '' values", () => {
    expect(stripUndefined({ n: null, f: false, z: 0, e: "" })).toEqual({
      n: null,
      f: false,
      z: 0,
      e: "",
    });
  });

  it("recurses into nested objects", () => {
    expect(
      stripUndefined({
        outer: { inner: undefined, kept: 1 },
        also: 2,
      }),
    ).toEqual({ outer: { kept: 1 }, also: 2 });
  });

  it("recurses into arrays of objects", () => {
    expect(
      stripUndefined([
        { a: 1, b: undefined },
        { a: 2, b: undefined },
      ]),
    ).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("passes through primitives unchanged", () => {
    expect(stripUndefined(5)).toBe(5);
    expect(stripUndefined("hello")).toBe("hello");
    expect(stripUndefined(null)).toBe(null);
    expect(stripUndefined(true)).toBe(true);
  });

  it("matches what JSON round-trip produces for the bug case", () => {
    // The widget posts { mode: "attempt", isCorrect: undefined } via
    // postMessage. JSON.stringify drops isCorrect; structuredClone keeps
    // it. stripUndefined should yield the JSON form so both sides of
    // the differ compare equal.
    const fromPostMessage = { mode: "attempt", isCorrect: undefined };
    const afterJsonRoundTrip = JSON.parse(JSON.stringify(fromPostMessage));
    expect(stripUndefined(fromPostMessage)).toEqual(afterJsonRoundTrip);
    expect(
      Object.prototype.hasOwnProperty.call(
        stripUndefined(fromPostMessage),
        "isCorrect",
      ),
    ).toBe(false);
  });
});
