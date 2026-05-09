import { beforeEach, describe, expect, it } from "vitest";
import { recorder } from "./bus";
import {
  REDACTED_TOKEN,
  SCHEMA_VERSION,
  type SetupConfig,
  type SetupConnect,
} from "./schema";

const config: SetupConfig = {
  platform: "claude",
  theme: "dark",
  displayMode: "inline",
  locale: "en-US",
  viewport: { preset: "desktop" },
  strictMode: false,
};

const connect: SetupConnect = {
  url: "http://localhost:9000",
  auth: { method: "bearer", token: "secret-token-value" },
};

beforeEach(() => {
  // Bring the singleton back to a clean state.
  if (recorder.mode === "recording") recorder.stop();
});

describe("Recorder bus", () => {
  it("drops emits while idle", () => {
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "x" },
    });
    recorder.start({ connect, config });
    const session = recorder.stop();
    expect(session.timeline).toHaveLength(0);
  });

  it("emits in monotonic relMs order while recording", async () => {
    recorder.start({ connect, config });
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "a" },
    });
    await new Promise((r) => setTimeout(r, 5));
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "b" },
    });
    const session = recorder.stop();
    expect(session.timeline).toHaveLength(2);
    expect(session.timeline[0].relMs).toBeLessThanOrEqual(
      session.timeline[1].relMs,
    );
  });

  it("clears the buffer after stop", () => {
    recorder.start({ connect, config });
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "a" },
    });
    recorder.stop();
    recorder.start({ connect, config });
    const session = recorder.stop();
    expect(session.timeline).toHaveLength(0);
  });

  it("redacts bearer token in setup.connect", () => {
    recorder.start({ connect, config });
    const session = recorder.stop();
    expect(session.setup.connect.auth).toEqual({
      method: "bearer",
      token: REDACTED_TOKEN,
    });
  });

  it("redacts oauth token in auth.update timeline entry", () => {
    recorder.start({ connect, config });
    recorder.emit({
      kind: "auth.update",
      patch: { method: "oauth", token: "super-secret" },
    });
    const session = recorder.stop();
    const auth = session.timeline[0];
    expect(auth.kind).toBe("auth.update");
    if (auth.kind === "auth.update") {
      expect(auth.patch).toEqual({ method: "oauth", token: REDACTED_TOKEN });
    }
  });

  it("emits the correct schema version", () => {
    recorder.start({ connect, config });
    expect(recorder.stop().version).toBe(SCHEMA_VERSION);
  });

  it("notifies subscribers on mode changes", () => {
    const seen: string[] = [];
    const unsubscribe = recorder.subscribe((mode) => seen.push(mode));
    recorder.start({ connect, config });
    recorder.stop();
    unsubscribe();
    expect(seen).toEqual(["recording", "idle"]);
  });

  it("attaches widget snapshot when setWidget is called", () => {
    recorder.start({ connect, config });
    recorder.setWidget({
      name: "search",
      html: "<div/>",
      initialMock: { x: 1 },
    });
    const session = recorder.stop();
    expect(session.widget).toEqual({
      name: "search",
      html: "<div/>",
      initialMock: { x: 1 },
    });
  });

  it("ignores setWidget while idle", () => {
    recorder.setWidget({ name: "x", html: "", initialMock: null });
    recorder.start({ connect, config });
    const session = recorder.stop();
    expect(session.widget).toBeUndefined();
  });

  it("markIndex returns the live buffer length", () => {
    recorder.start({ connect, config });
    expect(recorder.markIndex()).toBe(0);
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "a" },
    });
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "b" },
    });
    expect(recorder.markIndex()).toBe(2);
  });

  it("serializeRange returns a Session over [start, end)", () => {
    recorder.start({ connect, config });
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "a" },
    });
    const start = recorder.markIndex();
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "b" },
    });
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "c" },
    });
    const end = recorder.markIndex();
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "d" },
    });

    const session = recorder.serializeRange(start, end);
    expect(session.timeline).toHaveLength(2);
    if (session.timeline[0].kind === "sidebar.select") {
      expect(session.timeline[0].selection.name).toBe("b");
    }
    if (session.timeline[1].kind === "sidebar.select") {
      expect(session.timeline[1].selection.name).toBe("c");
    }
  });

  it("serializeRange clamps out-of-range indices", () => {
    recorder.start({ connect, config });
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "a" },
    });
    const session = recorder.serializeRange(-5, 999);
    expect(session.timeline).toHaveLength(1);
  });

  it("serializeRange with end omitted slices to the end of the buffer", () => {
    recorder.start({ connect, config });
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "a" },
    });
    recorder.emit({
      kind: "sidebar.select",
      selection: { type: "tool", name: "b" },
    });
    const session = recorder.serializeRange(1);
    expect(session.timeline).toHaveLength(1);
  });
});
