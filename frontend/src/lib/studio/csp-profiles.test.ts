import { describe, expect, it } from "vitest";
import { extractCspDomains } from "./csp-profiles";

describe("extractCspDomains", () => {
  it("returns empty arrays when meta has no csp keys", () => {
    expect(extractCspDomains({})).toEqual({
      connectDomains: [],
      resourceDomains: [],
      baseUriDomains: [],
      redirectDomains: [],
    });
  });

  it("reads connect/resource from openai/widgetCSP (snake_case)", () => {
    const meta = {
      "openai/widgetCSP": {
        connect_domains: ["api.example.com"],
        resource_domains: ["cdn.example.com"],
      },
    };
    expect(extractCspDomains(meta)).toMatchObject({
      connectDomains: ["api.example.com"],
      resourceDomains: ["cdn.example.com"],
    });
  });

  it("reads connect/resource from ui.csp (camelCase)", () => {
    const meta = {
      ui: {
        csp: {
          connectDomains: ["api.example.com"],
          resourceDomains: ["cdn.example.com"],
        },
      },
    };
    expect(extractCspDomains(meta)).toMatchObject({
      connectDomains: ["api.example.com"],
      resourceDomains: ["cdn.example.com"],
    });
  });

  it("reads redirect_domains from openai/widgetCSP only (no MCP equivalent)", () => {
    const meta = {
      "openai/widgetCSP": {
        redirect_domains: ["docs.example.com"],
      },
      ui: {
        csp: {
          // Intentional: even if upstream put "redirectDomains" under ui.csp
          // it's not in the spec, so we ignore it.
          redirectDomains: ["should-be-ignored.example.com"],
        },
      },
    };
    const out = extractCspDomains(meta);
    expect(out.redirectDomains).toEqual(["docs.example.com"]);
    expect(out.redirectDomains).not.toContain("should-be-ignored.example.com");
  });

  it("reads baseUriDomains from ui.csp only (no OpenAI equivalent)", () => {
    const meta = {
      ui: { csp: { baseUriDomains: ["cdn.example.com"] } },
      "openai/widgetCSP": {
        baseUriDomains: ["should-be-ignored.example.com"],
      },
    };
    const out = extractCspDomains(meta);
    expect(out.baseUriDomains).toEqual(["cdn.example.com"]);
    expect(out.baseUriDomains).not.toContain("should-be-ignored.example.com");
  });

  it("dedupes when the same domain appears in both shapes", () => {
    const meta = {
      "openai/widgetCSP": { connect_domains: ["api.example.com"] },
      ui: { csp: { connectDomains: ["api.example.com"] } },
    };
    expect(extractCspDomains(meta).connectDomains).toEqual(["api.example.com"]);
  });

  it("merges distinct entries from both shapes", () => {
    const meta = {
      "openai/widgetCSP": { connect_domains: ["a.example.com"] },
      ui: { csp: { connectDomains: ["b.example.com"] } },
    };
    const out = extractCspDomains(meta).connectDomains.sort();
    expect(out).toEqual(["a.example.com", "b.example.com"]);
  });

  it("ignores non-string entries", () => {
    const meta = {
      "openai/widgetCSP": {
        connect_domains: ["api.example.com", 42, null, { x: 1 }],
      },
    };
    expect(extractCspDomains(meta).connectDomains).toEqual(["api.example.com"]);
  });

  it("handles malformed shapes without throwing", () => {
    expect(() =>
      extractCspDomains({
        "openai/widgetCSP": "not-an-object",
        ui: 42,
      } as unknown as Record<string, unknown>),
    ).not.toThrow();
  });
});
