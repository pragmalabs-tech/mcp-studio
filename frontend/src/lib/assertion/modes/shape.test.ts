import { describe, it, expect } from "vitest";
import { modeShape } from "./shape";

describe("modeShape", () => {
  it("passes when shapes match (values differ)", () => {
    expect(
      modeShape(
        { id: "a", count: 1, tags: ["x"] },
        { id: "z", count: 99, tags: ["y", "w"] },
      ).status,
    ).toBe("passed");
  });

  it("fails when a required key is missing", () => {
    expect(modeShape({ id: "a", count: 1 }, { id: "z" } as object).status).toBe(
      "failed",
    );
  });

  it("fails when a leaf type changes", () => {
    expect(
      modeShape({ id: "a", count: 1 }, { id: "z", count: "1" }).status,
    ).toBe("failed");
  });

  it("passes when recorded is undefined (no baseline)", () => {
    expect(modeShape(undefined, { id: "z" }).status).toBe("passed");
  });

  it("passes when nested arrays share homogeneous element shape", () => {
    expect(
      modeShape(
        { items: [{ id: "a", n: 1 }] },
        {
          items: [
            { id: "b", n: 2 },
            { id: "c", n: 3 },
          ],
        },
      ).status,
    ).toBe("passed");
  });
});
