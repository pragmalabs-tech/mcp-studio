import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/studio/api", () => ({
  callTool: vi.fn(),
  readResource: vi.fn(),
}));

vi.mock("@/lib/studio/stores/widget-store", () => {
  const state: Record<string, unknown> = {
    logAction: vi.fn(),
    lastResult: null,
    jsonOutput: null,
  };
  return {
    useWidgetStore: {
      getState: () => state,
      setState: (patch: object | ((s: object) => object)) => {
        const next = typeof patch === "function" ? patch(state) : patch;
        Object.assign(state, next);
      },
    },
  };
});

import { ResourceReadAction } from "./resource_read";
import { readResource } from "@/lib/studio/api";

const mockedReadResource = vi.mocked(readResource);

describe("ResourceReadAction", () => {
  beforeEach(() => {
    mockedReadResource.mockReset();
  });

  it("populates result on success and produces a counter change", async () => {
    const uri = "widget://test";
    mockedReadResource.mockResolvedValueOnce({ html: "<div>x</div>" });
    const action = new ResourceReadAction(uri);

    await action.execute();

    expect(mockedReadResource).toHaveBeenCalledWith(uri);
    expect(action.result).toEqual({
      success: true,
      data: { html: "<div>x</div>" },
      error: undefined,
    });
    expect(action.change()).toEqual({
      resources: { [uri]: { readCount: 1 } },
      network: { requestCount: 1, responseCount: 1, errorCount: 0 },
    });
  });

  it("populates result with error on failure and bumps errorCount", async () => {
    const uri = "widget://missing";
    mockedReadResource.mockRejectedValueOnce(new Error("not found"));
    const action = new ResourceReadAction(uri);

    await action.execute();

    expect(action.result).toEqual({
      success: false,
      data: undefined,
      error: { message: "not found" },
    });
    expect(action.change()).toEqual({
      resources: { [uri]: { readCount: 1 } },
      network: { requestCount: 1, responseCount: 0, errorCount: 1 },
    });
  });

  it("declares an assertable surface with success as a strict point", () => {
    const success = ResourceReadAction.assertablePoints.find(
      (p) => p.key === "success",
    )!;
    expect(success.defaultMode).toBe("exact");
  });
});
