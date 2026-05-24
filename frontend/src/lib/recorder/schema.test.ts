import { describe, it, expect } from "vitest";
import { migrateSession, SCHEMA_VERSION, type Session } from "./schema";

describe("migrateSession", () => {
  it("upgrades a v2 TOOL_CALL session by wrapping result.data under data.tool", () => {
    const v2 = {
      version: 2,
      capturedAt: "2026-05-20T00:00:00.000Z",
      studioVersion: "0.2.0",
      setup: { url: "http://localhost:3000" },
      actions: [
        {
          relMs: 0,
          action: {
            id: "a1",
            type: "TOOL_CALL",
            data: { tool: "get_weather", params: { city: "SF" } },
            timestamp: 0,
            result: {
              success: true,
              data: { structuredContent: { temperature: 72 } },
            },
          },
        },
      ],
    } as unknown as Session;

    const migrated = migrateSession(v2);
    expect(migrated.version).toBe(SCHEMA_VERSION);
    expect(migrated.actions[0].action.result?.data).toEqual({
      tool: { structuredContent: { temperature: 72 } },
      widget: null,
      widgetId: null,
      snapshot: null,
    });
  });

  it("leaves RESOURCE_READ actions untouched during v2→v3 migration", () => {
    const v2 = {
      version: 2,
      capturedAt: "2026-05-20T00:00:00.000Z",
      studioVersion: "0.2.0",
      setup: { url: "" },
      actions: [
        {
          relMs: 0,
          action: {
            id: "r1",
            type: "RESOURCE_READ",
            data: { uri: "ui://widget/weather" },
            timestamp: 0,
            result: { success: true, data: { contents: [] } },
          },
        },
      ],
    } as unknown as Session;

    const migrated = migrateSession(v2);
    expect(migrated.actions[0].action.result?.data).toEqual({ contents: [] });
  });

  it("is idempotent — running twice does not double-wrap", () => {
    const v2 = {
      version: 2,
      capturedAt: "",
      studioVersion: "",
      setup: { url: "" },
      actions: [
        {
          relMs: 0,
          action: {
            id: "a",
            type: "TOOL_CALL",
            data: { tool: "t", params: {} },
            timestamp: 0,
            result: { success: true, data: { ok: true } },
          },
        },
      ],
    } as unknown as Session;

    const once = migrateSession(v2);
    const twice = migrateSession(once);
    expect(twice.actions[0].action.result?.data).toEqual({
      tool: { ok: true },
      widget: null,
      widgetId: null,
      snapshot: null,
    });
  });

  it("returns sessions already at the current version unchanged", () => {
    const current: Session = {
      version: SCHEMA_VERSION,
      capturedAt: "",
      studioVersion: "",
      setup: { url: "" },
      actions: [],
    };
    expect(migrateSession(current)).toBe(current);
  });
});
