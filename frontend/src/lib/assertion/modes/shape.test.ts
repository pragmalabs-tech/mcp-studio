import { describe, it, expect } from "vitest";
import { modeShape } from "./shape";

const UUID_A = "9f3a1b27-4c8d-4e2f-a1b9-c3d4e5f6a7b8";
const UUID_B = "2b8e6d11-9a3f-4c7e-b2d5-7f1a8c9e3d4b";
const ISO_A = "2026-05-23T10:00:00.000Z";
const ISO_B = "2027-01-02T03:04:05.000Z";
const JWT_A =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const JWT_B =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ODc2NTQzMjEwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("modeShape — structure", () => {
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

describe("modeShape — format-aware (generated values)", () => {
  it("passes when both uuid fields are valid uuids (values differ)", () => {
    expect(modeShape({ id: UUID_A }, { id: UUID_B }).status).toBe("passed");
  });

  it("fails when recorded uuid field receives a plain string", () => {
    expect(modeShape({ id: UUID_A }, { id: "not-a-uuid" }).status).toBe(
      "failed",
    );
  });

  it("passes when both iso-date fields are valid dates (values differ)", () => {
    expect(modeShape({ at: ISO_A }, { at: ISO_B }).status).toBe("passed");
  });

  it("fails when recorded iso-date field receives a plain string", () => {
    expect(modeShape({ at: ISO_A }, { at: "yesterday" }).status).toBe("failed");
  });

  it("passes when both jwt fields are valid jwts (values differ)", () => {
    expect(modeShape({ token: JWT_A }, { token: JWT_B }).status).toBe("passed");
  });

  it("fails when recorded jwt field receives a plain string", () => {
    expect(modeShape({ token: JWT_A }, { token: "not-a-jwt" }).status).toBe(
      "failed",
    );
  });

  it("passes when epoch-ms number changes but stays in epoch-ms range", () => {
    expect(modeShape({ ts: 1716459600000 }, { ts: 1730000000000 }).status).toBe(
      "passed",
    );
  });

  it("fails when epoch-ms field receives a non-epoch number", () => {
    expect(modeShape({ ts: 1716459600000 }, { ts: 42 }).status).toBe("failed");
  });

  it("passes nested object with mixed generated and plain fields", () => {
    expect(
      modeShape(
        { id: UUID_A, name: "doc", createdAt: ISO_A },
        { id: UUID_B, name: "other-doc", createdAt: ISO_B },
      ).status,
    ).toBe("passed");
  });
});
