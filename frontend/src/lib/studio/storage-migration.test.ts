// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  migrateLegacyKeys,
  migrateLocalStorageToBackend,
} from "./storage-migration";
import { SCHEMA_VERSION } from "../recorder/schema";

const DONE_FLAG = "studio:storage_migration_v1";

beforeEach(() => {
  localStorage.clear();
});

describe("migrateLegacyKeys", () => {
  it("renames mcpr_studio:* keys to studio:*", () => {
    localStorage.setItem(
      "mcpr_studio:http://localhost:3000:oauth_access_token",
      "tok-1",
    );
    localStorage.setItem(
      "mcpr_studio:http://localhost:3000:bearer_token",
      "bear-1",
    );

    migrateLegacyKeys();

    expect(
      localStorage.getItem("studio:http://localhost:3000:oauth_access_token"),
    ).toBe("tok-1");
    expect(
      localStorage.getItem("studio:http://localhost:3000:bearer_token"),
    ).toBe("bear-1");
    expect(
      localStorage.getItem(
        "mcpr_studio:http://localhost:3000:oauth_access_token",
      ),
    ).toBeNull();
    expect(
      localStorage.getItem("mcpr_studio:http://localhost:3000:bearer_token"),
    ).toBeNull();
  });

  it("renames mcpr_oauth_* keys to studio_oauth_*", () => {
    localStorage.setItem(
      "mcpr_oauth_http://localhost:3000_pkce_verifier",
      "verifier-1",
    );
    localStorage.setItem(
      "mcpr_oauth_http://localhost:3000_pkce_state",
      "state-1",
    );

    migrateLegacyKeys();

    expect(
      localStorage.getItem("studio_oauth_http://localhost:3000_pkce_verifier"),
    ).toBe("verifier-1");
    expect(
      localStorage.getItem("studio_oauth_http://localhost:3000_pkce_state"),
    ).toBe("state-1");
    expect(
      localStorage.getItem("mcpr_oauth_http://localhost:3000_pkce_verifier"),
    ).toBeNull();
  });

  it("renames mcpr_studio:pending_oauth:* keys", () => {
    localStorage.setItem("mcpr_studio:pending_oauth:client_id", "cid");
    localStorage.setItem("mcpr_studio:pending_oauth:state", "st");

    migrateLegacyKeys();

    expect(localStorage.getItem("studio:pending_oauth:client_id")).toBe("cid");
    expect(localStorage.getItem("studio:pending_oauth:state")).toBe("st");
  });

  it("sets the done flag and is idempotent", () => {
    localStorage.setItem("mcpr_studio:http://a.b:foo", "v1");

    migrateLegacyKeys();
    expect(localStorage.getItem(DONE_FLAG)).toBe("1");
    expect(localStorage.getItem("studio:http://a.b:foo")).toBe("v1");

    localStorage.setItem("mcpr_studio:http://a.b:bar", "v2");
    migrateLegacyKeys();
    expect(localStorage.getItem("studio:http://a.b:bar")).toBeNull();
    expect(localStorage.getItem("mcpr_studio:http://a.b:bar")).toBe("v2");
  });

  it("does not overwrite existing new-key values", () => {
    localStorage.setItem("mcpr_studio:o:k", "old");
    localStorage.setItem("studio:o:k", "new");

    migrateLegacyKeys();

    expect(localStorage.getItem("studio:o:k")).toBe("new");
    expect(localStorage.getItem("mcpr_studio:o:k")).toBeNull();
  });

  it("leaves unrelated keys untouched", () => {
    localStorage.setItem("some_other_key", "x");
    localStorage.setItem("studio:already_new:y", "y");

    migrateLegacyKeys();

    expect(localStorage.getItem("some_other_key")).toBe("x");
    expect(localStorage.getItem("studio:already_new:y")).toBe("y");
  });
});

describe("migrateLocalStorageToBackend", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs each saved test to the backend under its own id and removes the legacy key", async () => {
    localStorage.setItem(
      "mcp-studio-tests",
      JSON.stringify([
        {
          id: "old-uuid",
          name: "Search Flow",
          createdAt: "2026-01-01T00:00:00Z",
          session: {
            version: SCHEMA_VERSION,
            capturedAt: "",
            studioVersion: "",
            setup: { url: "" },
            actions: [],
          },
        },
      ]),
    );

    await migrateLocalStorageToBackend();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/studio/tests/old-uuid");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toMatchObject({
      id: "old-uuid",
      name: "Search Flow",
    });
    expect(localStorage.getItem("mcp-studio-tests")).toBeNull();
  });

  it("PUTs each replay and removes the legacy key", async () => {
    localStorage.setItem(
      "mcp-studio-replays",
      JSON.stringify([
        {
          id: "r1",
          testId: "search-flow",
          testName: "Search Flow",
          createdAt: "",
          durationMs: 0,
          status: "passed",
          actions: [],
        },
      ]),
    );

    await migrateLocalStorageToBackend();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/studio/run-results/r1");
    expect(localStorage.getItem("mcp-studio-replays")).toBeNull();
  });

  it("keeps the legacy key when a PUT fails so the next boot retries", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    localStorage.setItem(
      "mcp-studio-tests",
      JSON.stringify([
        {
          id: "old",
          name: "Search Flow",
          createdAt: "",
          session: {
            version: SCHEMA_VERSION,
            capturedAt: "",
            studioVersion: "",
            setup: { url: "" },
            actions: [],
          },
        },
      ]),
    );

    await migrateLocalStorageToBackend();

    expect(localStorage.getItem("mcp-studio-tests")).not.toBeNull();
  });

  it("drops the legacy key when JSON is garbled", async () => {
    localStorage.setItem("mcp-studio-tests", "{ broken");
    await migrateLocalStorageToBackend();
    expect(localStorage.getItem("mcp-studio-tests")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a no-op when no legacy data exists", async () => {
    await migrateLocalStorageToBackend();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
