import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolCallAction } from "./tool_call";

vi.mock("@/lib/studio/api", () => ({
  callTool: vi.fn(),
  readResource: vi.fn(),
}));

import { callTool } from "@/lib/studio/api";

const mockedCallTool = vi.mocked(callTool);

describe("ToolCallAction", () => {
  beforeEach(() => {
    mockedCallTool.mockReset();
  });

  it("populates result on success and produces a counter change", async () => {
    mockedCallTool.mockResolvedValueOnce({ temperature: 72 });
    const action = new ToolCallAction("get_weather", { city: "SF" });

    await action.execute();

    expect(mockedCallTool).toHaveBeenCalledWith("get_weather", { city: "SF" });
    expect(action.result).toEqual({
      success: true,
      data: { temperature: 72 },
      error: undefined,
    });
    expect(action.change()).toEqual({
      tools: { get_weather: { callCount: 1 } },
      network: { requestCount: 1, responseCount: 1, errorCount: 0 },
    });
  });

  it("populates result with error on failure and bumps errorCount", async () => {
    mockedCallTool.mockRejectedValueOnce(new Error("boom"));
    const action = new ToolCallAction("get_weather", { city: "SF" });

    await action.execute();

    expect(action.result).toEqual({
      success: false,
      data: undefined,
      error: { message: "boom" },
    });
    expect(action.change()).toEqual({
      tools: { get_weather: { callCount: 1 } },
      network: { requestCount: 1, responseCount: 0, errorCount: 1 },
    });
  });

  it("declares an assertable surface with success as a strict point", () => {
    const points = ToolCallAction.assertablePoints;
    expect(points.map((p) => p.key)).toContain("success");
    const success = points.find((p) => p.key === "success")!;
    expect(success.defaultMode).toBe("exact");
    expect(success.path).toBe("success");
  });

  it("instance exposes assertable points via accessor", () => {
    const action = new ToolCallAction("ping", {});
    expect(action.getAssertablePoints()).toBe(ToolCallAction.assertablePoints);
  });

  it("verifyResult(): passes when success matches under default modes", async () => {
    mockedCallTool.mockResolvedValueOnce({ ok: true });
    const action = new ToolCallAction("ping", {});
    await action.execute();

    const r = action.verifyResult(
      { success: true, data: { ok: true } },
      undefined,
    );
    expect(r.status).toBe("passed");
  });

  it("verifyResult(): failed with per-point reason when success diverges", async () => {
    mockedCallTool.mockResolvedValueOnce({ ok: true });
    const action = new ToolCallAction("ping", {});
    await action.execute();

    const r = action.verifyResult(
      { success: false, error: { message: "broken" } },
      undefined,
    );
    expect(r.status).toBe("failed");
    expect(r.data.failures?.[0].key).toBe("success");
  });

  it("verifyStateChange(): passes under default exact mode", async () => {
    mockedCallTool.mockResolvedValueOnce({ ok: true });
    const action = new ToolCallAction("ping", {});
    await action.execute();

    const recorded = action.change();
    const r = await action.verifyStateChange(recorded, { attempts: 1 });
    expect(r.status).toBe("passed");
  });
});
