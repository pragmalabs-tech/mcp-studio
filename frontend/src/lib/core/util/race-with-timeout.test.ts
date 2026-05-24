import { describe, it, expect } from "vitest";
import { raceWithTimeout } from "./race-with-timeout";

describe("raceWithTimeout", () => {
  it("resolves with the promise value when it settles first", async () => {
    const result = await raceWithTimeout(Promise.resolve("ok"), 50, "fallback");
    expect(result).toBe("ok");
  });

  it("resolves with the fallback when the promise never settles before the timer", async () => {
    const result = await raceWithTimeout(new Promise(() => {}), 1, "fallback");
    expect(result).toBe("fallback");
  });

  it("supports null as a fallback", async () => {
    const result = await raceWithTimeout<string | null>(
      new Promise(() => {}),
      1,
      null,
    );
    expect(result).toBeNull();
  });
});
