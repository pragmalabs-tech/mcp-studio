import { describe, it, expect } from "vitest";
import { modeFlaky } from "./flaky";

const UUID_A = "9f3a1b27-4c8d-4e2f-a1b9-c3d4e5f6a7b8";
const UUID_B = "2b8e6d11-9a3f-4c7e-b2d5-7f1a8c9e3d4b";
const ISO_A = "2026-05-23T10:00:00.000Z";
const ISO_B = "2027-01-02T03:04:05.000Z";

describe("modeFlaky", () => {
  it("passes when both leaves are same flaky kind (uuid)", () => {
    expect(modeFlaky(UUID_A, UUID_B).status).toBe("passed");
  });

  it("passes when both leaves are same flaky kind (iso-date)", () => {
    expect(modeFlaky(ISO_A, ISO_B).status).toBe("passed");
  });

  it("passes nested mixed values where uuids differ but rest matches", () => {
    expect(
      modeFlaky(
        { id: UUID_A, name: "doc", at: ISO_A },
        { id: UUID_B, name: "doc", at: ISO_B },
      ).status,
    ).toBe("passed");
  });

  it("fails when uuid vs literal string", () => {
    expect(modeFlaky(UUID_A, "not-a-uuid").status).toBe("failed");
  });

  it("fails when uuid vs different kind (iso-date)", () => {
    expect(modeFlaky(UUID_A, ISO_A).status).toBe("failed");
  });

  it("fails when non-flaky values diverge", () => {
    expect(modeFlaky({ name: "doc" }, { name: "other" }).status).toBe("failed");
  });

  it("epoch-ms numbers match each other across replays", () => {
    expect(modeFlaky(1716459600000, 1730000000000).status).toBe("passed");
  });
});
