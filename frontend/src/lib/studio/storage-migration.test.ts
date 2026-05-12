// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyKeys } from "./storage-migration";

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
