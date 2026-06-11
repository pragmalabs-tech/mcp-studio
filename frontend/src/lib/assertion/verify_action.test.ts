import { describe, it, expect } from "vitest";
import { verifyAction } from "./verify_action";
import type { AssertablePoint } from "./types";

const points: AssertablePoint[] = [
  {
    key: "success",
    label: "Success",
    path: "success",
    defaultMode: "exact",
    supportedModes: ["exact", "ignore"],
  },
  {
    key: "data.id",
    label: "ID",
    path: "data.id",
    defaultMode: "exact",
    supportedModes: ["exact", "shape", "ignore"],
  },
];

describe("verifyAction", () => {
  it("skipped when no recorded baseline", () => {
    const r = verifyAction(points, undefined, { success: true }, undefined);
    expect(r.status).toBe("skipped");
  });

  it("failed when actual is missing", () => {
    const r = verifyAction(points, { success: true }, undefined, undefined);
    expect(r.status).toBe("failed");
    expect(r.data.reason).toMatch(/did not produce/);
  });

  it("passes when every point matches under default modes", () => {
    const r = verifyAction(
      points,
      { success: true, data: { id: "x" } },
      { success: true, data: { id: "x" } },
      undefined,
    );
    expect(r.status).toBe("passed");
  });

  it("aggregates per-point failures with key + mode + reason", () => {
    const r = verifyAction(
      points,
      { success: true, data: { id: "x" } },
      { success: false, data: { id: "y" } },
      undefined,
    );
    expect(r.status).toBe("failed");
    expect(r.data.failures?.map((f) => f.key).sort()).toEqual([
      "data.id",
      "success",
    ]);
    for (const f of r.data.failures!) {
      expect(f.mode).toBe("exact");
      expect(f.reason).toBeTruthy();
    }
  });

  it("ignore mode skips a point even if values differ", () => {
    const r = verifyAction(
      points,
      { success: true, data: { id: "x" } },
      { success: false, data: { id: "x" } },
      { success: "ignore" },
    );
    expect(r.status).toBe("passed");
  });

  it("shape on data.id passes uuids without exact match", () => {
    const r = verifyAction(
      points,
      { success: true, data: { id: "9f3a1b27-4c8d-4e2f-a1b9-c3d4e5f6a7b8" } },
      { success: true, data: { id: "2b8e6d11-9a3f-4c7e-b2d5-7f1a8c9e3d4b" } },
      { "data.id": "shape" },
    );
    expect(r.status).toBe("passed");
  });
});
