import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  isKnownActionKind,
  validateSession,
  type Session,
} from "./schema";

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

describe("isKnownActionKind", () => {
  it("recognizes all documented kinds", () => {
    for (const kind of [
      "sidebar.select",
      "editor.set_args",
      "config.update",
      "auth.update",
      "mcp.request",
      "mcp.response",
      "mcp.notification",
      "widget.render",
      "widget.mock.set",
      "widget.intent",
      "widget.dom.click",
      "widget.dom.input",
      "widget.dom.change",
      "widget.dom.submit",
      "widget.dom.keydown",
      "widget.render.complete",
      "csp.violation",
    ]) {
      expect(isKnownActionKind(kind)).toBe(true);
    }
  });

  it("rejects unknown kinds", () => {
    expect(isKnownActionKind("widget.dom.scroll")).toBe(false);
    expect(isKnownActionKind("")).toBe(false);
  });
});

describe("validateSession", () => {
  it("accepts a minimal session", () => {
    expect(validateSession(minimalSession)).toBe(true);
  });

  it("accepts a session with timeline entries", () => {
    const s: Session = {
      ...minimalSession,
      timeline: [
        {
          relMs: 0,
          kind: "sidebar.select",
          selection: { type: "tool", name: "x" },
        },
        {
          relMs: 100,
          kind: "mcp.request",
          id: 1,
          source: "user",
          method: "tools/call",
          params: { name: "x", arguments: {} },
        },
        {
          relMs: 200,
          kind: "mcp.response",
          requestId: 1,
          result: { ok: true },
          durationMs: 50,
        },
      ],
    };
    expect(validateSession(s)).toBe(true);
  });

  it("rejects wrong version", () => {
    expect(validateSession({ ...minimalSession, version: 99 })).toBe(false);
  });

  it("rejects missing setup", () => {
    expect(validateSession({ ...minimalSession, setup: undefined })).toBe(
      false,
    );
  });

  it("rejects timeline entry with unknown kind", () => {
    const s = {
      ...minimalSession,
      timeline: [{ relMs: 0, kind: "made.up", payload: 1 }],
    };
    expect(validateSession(s)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(validateSession(null)).toBe(false);
    expect(validateSession(42)).toBe(false);
    expect(validateSession("session")).toBe(false);
  });
});
