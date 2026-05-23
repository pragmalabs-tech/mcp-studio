import { describe, it, expect } from "vitest";
import { modeIgnore } from "./ignore";

describe("modeIgnore", () => {
  it("always passes regardless of inputs", () => {
    expect(modeIgnore().status).toBe("passed");
  });
});
