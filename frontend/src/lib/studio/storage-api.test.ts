import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listTestSummaries,
  getTest,
  putTest,
  deleteTest,
  listReplaySummaries,
  getReplay,
  putReplay,
  deleteReplay,
} from "./storage-api";
import { SCHEMA_VERSION } from "../recorder/schema";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage-api — tests", () => {
  it("listTestSummaries GETs /api/studio/tests and returns the parsed list", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          name: "search-flow",
          size: 100,
          modified_ms: 1,
          display_name: "Search Flow",
          description: null,
          created_at: null,
        },
      ]),
    );
    const result = await listTestSummaries();
    expect(fetchMock).toHaveBeenCalledWith("/api/studio/tests");
    expect(result).toHaveLength(1);
    expect(result[0].display_name).toBe("Search Flow");
  });

  it("getTest returns null on 404", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const result = await getTest("missing");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/studio/tests/missing");
  });

  it("putTest PUTs JSON to the slug path", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        name: "search-flow",
        size: 100,
        modified_ms: 1,
        display_name: null,
        description: null,
        created_at: null,
      }),
    );
    await putTest("search-flow", {
      id: "search-flow",
      name: "Search Flow",
      createdAt: "2026-01-01T00:00:00Z",
      session: {
        version: SCHEMA_VERSION,
        capturedAt: "",
        studioVersion: "",
        setup: { url: "" },
        actions: [],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/studio/tests/search-flow");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toMatchObject({ id: "search-flow" });
  });

  it("deleteTest DELETEs the slug path", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteTest("search-flow");
    expect(fetchMock).toHaveBeenCalledWith("/api/studio/tests/search-flow", {
      method: "DELETE",
    });
  });
});

describe("storage-api — replays", () => {
  it("listReplaySummaries hits /api/studio/run-results", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await listReplaySummaries();
    expect(fetchMock).toHaveBeenCalledWith("/api/studio/run-results");
  });

  it("getReplay returns null on 404", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await getReplay("nope")).toBeNull();
  });

  it("putReplay PUTs JSON to the id path", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "abc",
        size: 1,
        modified_ms: 1,
        test_id: "search-flow",
        started_at: null,
        finished_at: null,
        run_type: null,
        filter: null,
        env: null,
        summary: null,
      }),
    );
    await putReplay("abc", {
      id: "abc",
      testId: "search-flow",
      testName: "Search Flow",
      createdAt: "",
      durationMs: 0,
      status: "passed",
      actions: [],
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/studio/run-results/abc");
  });

  it("deleteReplay DELETEs the id path", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteReplay("abc");
    expect(fetchMock).toHaveBeenCalledWith("/api/studio/run-results/abc", {
      method: "DELETE",
    });
  });

  it("surfaces backend error.message when a request fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "disk full" }, { status: 500 }),
    );
    await expect(getReplay("abc")).rejects.toThrow("disk full");
  });
});
