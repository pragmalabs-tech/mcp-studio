import { describe, expect, it } from "vitest";
import { assertFor } from "./asserter";
import type { Action } from "@/lib/recorder/schema";
import type { DriveOutcome } from "./drivers/types";

const ok = (observation?: unknown): DriveOutcome => ({
  ok: true,
  durationMs: 10,
  observation,
});

const fail = (reason: string): DriveOutcome => ({
  ok: false,
  durationMs: 10,
  reason,
});

describe("asserter — mcp.request", () => {
  const action: Action = {
    kind: "mcp.request",
    id: 1,
    source: "user",
    method: "tools/call",
    params: {},
  };
  const a = assertFor(action);

  it("passes when response has no error", () => {
    expect(a(action, ok({ result: { ok: true } }), undefined).status).toBe(
      "pass",
    );
  });

  it("fails when response has an error", () => {
    const r = a(action, ok({ error: { message: "boom" } }), undefined);
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("boom");
  });

  it("fails when driver did not produce an observation", () => {
    expect(a(action, ok(undefined), undefined).status).toBe("fail");
  });

  it("propagates driver failure", () => {
    expect(a(action, fail("network error"), undefined).status).toBe("fail");
  });
});

describe("asserter — widget.render", () => {
  const action: Action = {
    kind: "widget.render",
    name: "x",
    htmlHash: "abc",
    initialMock: {},
  };
  const a = assertFor(action);

  it("passes when bodyChars > 0 and no runtime errors", () => {
    expect(
      a(
        action,
        ok({
          bodyChars: 100,
          hasRuntimeErrors: false,
          handshakeOk: true,
          renderDurationMs: 50,
        }),
        undefined,
      ).status,
    ).toBe("pass");
  });

  it("fails on empty body", () => {
    const r = a(
      action,
      ok({
        bodyChars: 0,
        hasRuntimeErrors: false,
        handshakeOk: true,
        renderDurationMs: 50,
      }),
      undefined,
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toMatch(/empty/);
  });

  it("fails on runtime error", () => {
    const r = a(
      action,
      ok({
        bodyChars: 100,
        hasRuntimeErrors: true,
        handshakeOk: true,
        renderDurationMs: 50,
      }),
      undefined,
    );
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toMatch(/runtime/);
  });
});

describe("asserter — widget.dom.click (requires mutation)", () => {
  const action: Action = {
    kind: "widget.dom.click",
    selectors: { testid: "btn" },
    mutated: true,
  };
  const a = assertFor(action);

  it("passes when bridge ack mutated=true", () => {
    expect(a(action, ok({ ok: true, mutated: true }), undefined).status).toBe(
      "pass",
    );
  });

  it("fails when bridge ack mutated=false", () => {
    const r = a(action, ok({ ok: true, mutated: false }), undefined);
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toMatch(/mutate/);
  });

  it("fails when bridge ack ok=false", () => {
    const r = a(action, ok({ ok: false, reason: "selector-miss" }), undefined);
    expect(r.status).toBe("fail");
    if (r.status === "fail") expect(r.reason).toBe("selector-miss");
  });
});

describe("asserter — widget.dom.input (mutation optional)", () => {
  const action: Action = {
    kind: "widget.dom.input",
    selectors: { testid: "input" },
    value: "hi",
    inputType: "insertText",
  };
  const a = assertFor(action);

  it("passes with mutated=false (input may not visibly mutate body)", () => {
    expect(a(action, ok({ ok: true, mutated: false }), undefined).status).toBe(
      "pass",
    );
  });

  it("fails when ack ok=false", () => {
    expect(a(action, ok({ ok: false, reason: "x" }), undefined).status).toBe(
      "fail",
    );
  });
});

describe("asserter — pure inputs default to pass-through", () => {
  const action: Action = {
    kind: "config.update",
    patch: { theme: "dark" },
  };
  const a = assertFor(action);
  it("passes when driver succeeds", () => {
    expect(a(action, ok(), undefined).status).toBe("pass");
  });
  it("fails when driver fails", () => {
    expect(a(action, fail("setter threw"), undefined).status).toBe("fail");
  });
});
