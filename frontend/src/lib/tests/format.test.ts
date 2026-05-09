import { describe, expect, it } from "vitest";
import { newTest, slugify } from "./format";
import { SCHEMA_VERSION, type Session } from "@/lib/recorder/schema";

const minimalSession: Session = {
  version: SCHEMA_VERSION,
  capturedAt: "2026-05-09T00:00:00Z",
  studioVersion: "0.1.0",
  setup: {
    connect: {
      url: "http://localhost:9000",
      auth: { method: "bearer", token: "" },
    },
    config: {
      platform: "claude",
      theme: "dark",
      displayMode: "inline",
      locale: "en-US",
      viewport: { preset: "desktop" },
      strictMode: false,
    },
  },
  timeline: [],
};

describe("newTest", () => {
  it("produces a stable shape with uuid and ISO timestamp", () => {
    const t = newTest({ name: "Search flow", session: minimalSession });
    expect(t.name).toBe("Search flow");
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t.session).toBe(minimalSession);
  });

  it("preserves description when given", () => {
    const t = newTest({
      name: "x",
      description: "my desc",
      session: minimalSession,
    });
    expect(t.description).toBe("my desc");
  });

  it("omits description when not given", () => {
    const t = newTest({ name: "x", session: minimalSession });
    expect(t.description).toBeUndefined();
  });
});

describe("slugify (mirror of backend safe_filename)", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Search Flow")).toBe("search-flow");
  });

  it("keeps existing dashes and underscores once", () => {
    expect(slugify("a---b___c")).toBe("a-b_c");
  });

  it("strips path traversal characters", () => {
    expect(slugify("../etc/passwd")).toBe("etcpasswd");
    expect(slugify("/abs")).toBe("abs");
  });

  it("trims trailing separators", () => {
    expect(slugify("---trim---")).toBe("trim");
  });

  it("falls back to untitled for empty / all-stripped input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("///")).toBe("untitled");
    expect(slugify("   ")).toBe("untitled");
  });

  it("caps length at 64 chars", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});
