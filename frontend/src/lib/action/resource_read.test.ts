import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResourceReadAction } from "./resource_read";

vi.mock("@/lib/studio/api", () => ({
  callTool: vi.fn(),
  readResource: vi.fn(),
}));

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

  it("verify(): passes when success matches recorded", async () => {
    mockedReadResource.mockResolvedValueOnce({});
    const action = new ResourceReadAction("widget://x");
    await action.execute();

    expect(action.verify({ success: true, data: {} }).status).toBe("passed");
  });
});
