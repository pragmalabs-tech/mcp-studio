import { describe, expect, it } from "vitest";
import { renderHtml } from "./render-html";
import type { MockData } from "@/lib/studio/mock-openai";

const PAGE = `<html><head><title>x</title></head><body><p>ok</p></body></html>`;

const baseMock = (over: Partial<MockData> = {}): MockData => ({
  toolInput: {},
  toolOutput: {},
  _meta: {},
  widgetState: null,
  theme: "dark",
  locale: "en-US",
  displayMode: "compact",
  ...over,
});

describe("renderHtml - strict mode", () => {
  it("strict + openai injects CSP meta and sandbox trap", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: true,
    });
    expect(out.html).toContain(`Content-Security-Policy`);
    expect(out.html).toContain(`studio_sandbox_violation`);
  });

  it("strict + claude injects CSP meta and sandbox trap (different profile)", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "claude",
      strict: true,
    });
    expect(out.html).toContain(`Content-Security-Policy`);
    expect(out.html).toContain(`studio_sandbox_violation`);
  });

  it("relaxed mode does NOT inject CSP meta or sandbox trap", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: false,
    });
    expect(out.html).not.toContain(`Content-Security-Policy`);
    expect(out.html).not.toContain(`studio_sandbox_violation`);
  });
});

describe("renderHtml - platform mocks", () => {
  it("openai injects window.openai mock script", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock({ toolInput: { greet: "hi" } }),
      platform: "openai",
      strict: false,
    });
    expect(out.html).toContain(`window.openai`);
    expect(out.html).toContain(`"greet"`);
  });

  it("claude injects link interceptor, not window.openai", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "claude",
      strict: false,
    });
    expect(out.html).toContain(`ui/open-link`);
    expect(out.html).not.toContain(`window.openai`);
  });
});

describe("renderHtml - bridge injection", () => {
  it("bridgeSource set + relaxed: injects bridge", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: false,
      bridgeSource: `/* BRIDGE */`,
    });
    expect(out.html).toContain(`<script>/* BRIDGE */</script>`);
  });

  it("bridgeSource set + strict: bridge is SKIPPED (CSP would block it)", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: true,
      bridgeSource: `/* BRIDGE */`,
    });
    expect(out.html).not.toContain(`/* BRIDGE */`);
  });

  it("no bridgeSource: bridge is omitted", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: false,
    });
    expect(out.html).not.toContain(`/* BRIDGE */`);
  });
});

describe("renderHtml - tunnel URL rewrite", () => {
  it("rewrites tunnel URLs when baseUrl is set", () => {
    const html = `<html><head></head><body><img src="https://abc.tunnel.mcpr.app/x.png"></body></html>`;
    const out = renderHtml({
      html,
      mock: baseMock(),
      platform: "openai",
      strict: false,
      baseUrl: "http://localhost:9000",
    });
    expect(out.html).toContain("http://localhost:9000/x.png");
    expect(out.html).not.toContain("tunnel.mcpr.app");
  });
});

describe("renderHtml - console forwarding", () => {
  it("relaxed mode: injects console forwarder", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: false,
    });
    expect(out.html).toContain("studio_console");
    expect(out.html).toContain("unhandledrejection");
  });

  it("strict mode: console forwarder is SKIPPED (CSP would block)", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: true,
    });
    expect(out.html).not.toContain("studio_console");
  });
});

describe("renderHtml - viewOnly", () => {
  it("viewOnly omitted: no input-blocking script", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: false,
    });
    expect(out.html).not.toContain("pointer-events:none");
  });

  it("viewOnly true: injects pointer/keyboard blocker", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock(),
      platform: "openai",
      strict: false,
      viewOnly: true,
    });
    expect(out.html).toContain("pointer-events:none");
    expect(out.html).toContain("stopPropagation");
  });
});

describe("renderHtml - cspDomains output", () => {
  it("returns the CSP domains it derived from mock._meta", () => {
    const out = renderHtml({
      html: PAGE,
      mock: baseMock({
        _meta: {
          ui: {
            csp: {
              connectDomains: ["api.example.com"],
              resourceDomains: ["cdn.example.com"],
            },
          },
        },
      }),
      platform: "claude",
      strict: false,
    });
    expect(out.cspDomains.connectDomains).toEqual(["api.example.com"]);
    expect(out.cspDomains.resourceDomains).toEqual(["cdn.example.com"]);
  });
});
