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

  it("verify(): passed when success boolean matches recorded", async () => {
    mockedCallTool.mockResolvedValueOnce({ ok: true });
    const action = new ToolCallAction("ping", {});
    await action.execute();

    const report = action.verify({
      success: true,
      data: { ok: true },
    });
    expect(report.status).toBe("passed");
  });

  it("verify(): failed when success boolean diverges", async () => {
    mockedCallTool.mockResolvedValueOnce({ ok: true });
    const action = new ToolCallAction("ping", {});
    await action.execute();

    const report = action.verify({
      success: false,
      error: { message: "previously broken" },
    });
    expect(report.status).toBe("failed");
    expect(report.data.reason).toMatch(/success mismatch/);
  });

  it("verify(): skipped when no recorded baseline", async () => {
    mockedCallTool.mockResolvedValueOnce({ ok: true });
    const action = new ToolCallAction("ping", {});
    await action.execute();

    expect(action.verify(undefined).status).toBe("skipped");
  });
});
