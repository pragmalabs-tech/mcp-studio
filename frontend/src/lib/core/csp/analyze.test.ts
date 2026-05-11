import { describe, expect, it } from "vitest";
import { analyze, isAllowed } from "./analyze";
import type { CspDomains, CspFinding } from "./types";

const emptyDomains = (): CspDomains => ({
  connectDomains: [],
  resourceDomains: [],
  baseUriDomains: [],
  redirectDomains: [],
});

const withDomains = (overrides: Partial<CspDomains>): CspDomains => ({
  ...emptyDomains(),
  ...overrides,
});

const findFinding = (findings: CspFinding[], directive: string) =>
  findings.find((f) => f.directive === directive);

const findingsOf = (html: string, domains: CspDomains = emptyDomains()) =>
  analyze(html, domains).findings;

describe("isAllowed (matcher)", () => {
  it("matches bare hostname against https URL", () => {
    expect(isAllowed("https://api.example.com/x", ["api.example.com"])).toBe(
      true,
    );
  });

  it("matches bare hostname against http URL too (scheme is optional)", () => {
    expect(isAllowed("http://api.example.com/x", ["api.example.com"])).toBe(
      true,
    );
  });

  it("schemed entry only matches its scheme", () => {
    expect(
      isAllowed("http://api.example.com/x", ["https://api.example.com"]),
    ).toBe(false);
    expect(
      isAllowed("https://api.example.com/x", ["https://api.example.com"]),
    ).toBe(true);
  });

  it("non-matching host fails", () => {
    expect(isAllowed("https://other.com/x", ["api.example.com"])).toBe(false);
  });

  it("wildcard matches subdomains", () => {
    expect(isAllowed("https://api.example.com/x", ["*.example.com"])).toBe(
      true,
    );
    expect(isAllowed("https://a.b.example.com/x", ["*.example.com"])).toBe(
      true,
    );
  });

  it("wildcard does NOT match the apex (per CSP grammar)", () => {
    expect(isAllowed("https://example.com/x", ["*.example.com"])).toBe(false);
  });

  it("ignores empty/whitespace entries", () => {
    expect(isAllowed("https://api.example.com/x", ["", "  "])).toBe(false);
  });

  it("hostname matching is case-insensitive", () => {
    expect(isAllowed("https://API.example.com/x", ["api.example.com"])).toBe(
      true,
    );
    expect(isAllowed("https://api.example.com/x", ["API.EXAMPLE.COM"])).toBe(
      true,
    );
  });

  it("invalid URL returns false (does not throw)", () => {
    expect(isAllowed("not-a-url", ["api.example.com"])).toBe(false);
  });

  it("URL with port matches port-less declared host", () => {
    expect(
      isAllowed("https://api.example.com:8080/x", ["api.example.com"]),
    ).toBe(true);
  });
});

describe("analyze - script rules", () => {
  it("flags external <script src> not in resourceDomains", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const f = findFinding(findingsOf(html), "script-src");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warning");
    expect(f!.fix).toContain("mcpr.toml");
    expect(f!.fix).toContain("resourceDomains");
  });

  it("allows external <script src> when host is in resourceDomains", () => {
    const html = `<script src="https://cdn.example.com/x.js"></script>`;
    const findings = findingsOf(
      html,
      withDomains({ resourceDomains: ["cdn.example.com"] }),
    );
    expect(findFinding(findings, "script-src")).toBeUndefined();
  });

  it("flags relative <script src> as error regardless of domains", () => {
    const html = `<script src="/assets/main.js"></script>`;
    const findings = findingsOf(
      html,
      withDomains({ resourceDomains: ["cdn.example.com"] }),
    );
    const errs = findings.filter(
      (i) => i.directive === "script-src" && i.severity === "error",
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag inline <script> blocks (regression: false-positive removed)", () => {
    const html = `<script>let x = 1; window.postMessage({}, "*");</script>`;
    const findings = findingsOf(html);
    expect(findings.filter((i) => i.directive === "script-src")).toHaveLength(
      0,
    );
  });
});

describe("analyze - stylesheet rules", () => {
  it("flags external <link rel=stylesheet> not in resourceDomains", () => {
    const html = `<link rel="stylesheet" href="https://cdn.unknown.com/x.css">`;
    expect(findFinding(findingsOf(html), "style-src")).toBeDefined();
  });

  it("allows external stylesheet when host is in resourceDomains", () => {
    const html = `<link rel="stylesheet" href="https://cdn.example.com/x.css">`;
    const findings = findingsOf(
      html,
      withDomains({ resourceDomains: ["cdn.example.com"] }),
    );
    expect(findFinding(findings, "style-src")).toBeUndefined();
  });

  it("flags relative stylesheet href", () => {
    const html = `<link rel="stylesheet" href="/styles.css">`;
    const errs = findingsOf(html).filter(
      (i) => i.directive === "style-src" && i.severity === "error",
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("analyze - image rule", () => {
  it("flags external <img src> not in resourceDomains", () => {
    const html = `<img src="https://cdn.unknown.com/pic.png">`;
    expect(findFinding(findingsOf(html), "img-src")).toBeDefined();
  });

  it("allows external <img src> when host is in resourceDomains", () => {
    const html = `<img src="https://cdn.example.com/pic.png">`;
    const findings = findingsOf(
      html,
      withDomains({ resourceDomains: ["cdn.example.com"] }),
    );
    expect(findFinding(findings, "img-src")).toBeUndefined();
  });
});

describe("analyze - eval / new Function", () => {
  it("flags unguarded eval() as error", () => {
    const html = `<script>eval("1+1")</script>`;
    const f = findingsOf(html).find((i) => i.blocked === "eval(...)");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
  });

  it("flags unguarded new Function() as error", () => {
    const html = `<script>const f = new Function("return 1");</script>`;
    const f = findingsOf(html).find((i) => i.blocked === "new Function(...)");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
  });

  it("downgrades eval() in try/catch to warning", () => {
    const html = `<script>try { eval("1+1") } catch { /* ignore */ }</script>`;
    const f = findingsOf(html).find((i) => i.blocked === "eval(...)");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warning");
    expect(f!.description).toContain("try/catch");
  });

  it("downgrades new Function() in try/catch to warning (Zod allowsEval pattern)", () => {
    const html = `<script>try{return new Function(""),!0}catch{return!1}</script>`;
    const f = findingsOf(html).find((i) => i.blocked === "new Function(...)");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warning");
    expect(f!.description).toContain("try/catch");
  });

  it("downgrades new Function() in multi-line try/catch", () => {
    const html = [
      "<script>",
      "  function probe() {",
      "    try {",
      '      return new Function("return 1")();',
      "    } catch (e) {",
      "      return null;",
      "    }",
      "  }",
      "</script>",
    ].join("\n");
    const f = findingsOf(html).find((i) => i.blocked === "new Function(...)");
    expect(f!.severity).toBe("warning");
  });

  it("does NOT downgrade when try/catch precedes the call but closes before it", () => {
    const html = `<script>try { foo() } catch { bar() } eval("x")</script>`;
    const f = findingsOf(html).find((i) => i.blocked === "eval(...)");
    expect(f!.severity).toBe("error");
  });
});

describe("analyze - fetch / XHR", () => {
  it("flags fetch() to host not in connectDomains", () => {
    const html = `<script>fetch("https://api.unknown.com/v1")</script>`;
    const f = findFinding(findingsOf(html), "connect-src");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.fix).toContain("connectDomains");
  });

  it("allows fetch() when host is in connectDomains", () => {
    const html = `<script>fetch("https://api.example.com/v1")</script>`;
    const findings = findingsOf(
      html,
      withDomains({ connectDomains: ["api.example.com"] }),
    );
    expect(findFinding(findings, "connect-src")).toBeUndefined();
  });

  it("allows fetch() under wildcard subdomain", () => {
    const html = `<script>fetch("https://api.foo.example.com/v1")</script>`;
    const findings = findingsOf(
      html,
      withDomains({ connectDomains: ["*.example.com"] }),
    );
    expect(findFinding(findings, "connect-src")).toBeUndefined();
  });
});

describe("analyze - CSS url()", () => {
  it("flags url() pointing to host not in resourceDomains", () => {
    const html = `<style>@font-face { src: url("https://cdn.unknown.com/f.woff"); }</style>`;
    expect(findFinding(findingsOf(html), "font-src / style-src")).toBeDefined();
  });
});

describe("analyze - iframe / object / embed", () => {
  it("flags <iframe> as error", () => {
    const html = `<iframe src="x"></iframe>`;
    expect(findFinding(findingsOf(html), "frame-src")).toBeDefined();
  });

  it("flags <object> as error", () => {
    const html = `<object data="x"></object>`;
    expect(findFinding(findingsOf(html), "object-src")).toBeDefined();
  });

  it("flags <embed> as error", () => {
    const html = `<embed src="x">`;
    expect(findFinding(findingsOf(html), "object-src")).toBeDefined();
  });
});

describe("analyze - base-uri (MCP spec)", () => {
  it("flags <base href> with absolute URL not in baseUriDomains", () => {
    const html = `<base href="https://cdn.unknown.com/">`;
    const f = findFinding(findingsOf(html), "base-uri");
    expect(f).toBeDefined();
    expect(f!.fix).toContain("baseUriDomains");
    expect(f!.fix).toContain("mcpr.toml");
  });

  it("allows <base href> when host is in baseUriDomains", () => {
    const html = `<base href="https://cdn.example.com/">`;
    const findings = findingsOf(
      html,
      withDomains({ baseUriDomains: ["cdn.example.com"] }),
    );
    expect(findFinding(findings, "base-uri")).toBeUndefined();
  });

  it("does NOT flag relative <base href>", () => {
    const html = `<base href="./assets/">`;
    expect(findFinding(findingsOf(html), "base-uri")).toBeUndefined();
  });
});

describe("analyze - openExternal redirect (OpenAI)", () => {
  it("flags openExternal target not in redirectDomains", () => {
    const html = `<script>openai.openExternal("https://docs.unknown.com")</script>`;
    const f = findFinding(findingsOf(html), "redirect");
    expect(f).toBeDefined();
    expect(f!.platforms).toEqual(["ChatGPT"]);
    expect(f!.fix).toContain("redirectDomains");
  });

  it("allows openExternal when target is in redirectDomains", () => {
    const html = `<script>openai.openExternal("https://docs.example.com")</script>`;
    const findings = findingsOf(
      html,
      withDomains({ redirectDomains: ["docs.example.com"] }),
    );
    expect(findFinding(findings, "redirect")).toBeUndefined();
  });
});

describe("analyze - restricted browser APIs (data-driven)", () => {
  it("flags localStorage usage", () => {
    const html = `<script>localStorage.getItem("x")</script>`;
    const findings = findingsOf(html);
    expect(findings.find((i) => i.blocked === "localStorage")).toBeDefined();
  });

  it("flags getUserMedia()", () => {
    const html = `<script>navigator.mediaDevices.getUserMedia({})</script>`;
    const findings = findingsOf(html);
    expect(findings.find((i) => i.blocked === "getUserMedia()")).toBeDefined();
  });

  it("flags new PaymentRequest()", () => {
    const html = `<script>new PaymentRequest([], {})</script>`;
    const findings = findingsOf(html);
    expect(
      findings.find((i) => i.blocked === "new PaymentRequest()"),
    ).toBeDefined();
  });
});

describe("analyze - fix message format", () => {
  it("leads with the server-side _meta path (works without mcpr)", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const f = findFinding(findingsOf(html), "script-src")!;
    const lines = f.fix.split("\n");
    expect(lines[0]).toMatch(/^Add /);
    const aIdx = lines.findIndex((l) => l.includes("MCP server code"));
    const bIdx = lines.findIndex((l) => l.includes("mcpr proxy"));
    expect(aIdx).toBeGreaterThan(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it("includes both MCP-Apps and OpenAI _meta forms for non-baseUri/redirect directives", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const f = findFinding(findingsOf(html), "script-src")!;
    expect(f.fix).toContain("_meta.ui.csp.resourceDomains");
    expect(f.fix).toContain("_meta.openai/widgetCSP.resource_domains");
  });

  it("baseUri fix references only the MCP Apps shape", () => {
    const html = `<base href="https://cdn.unknown.com/">`;
    const f = findFinding(findingsOf(html), "base-uri")!;
    expect(f.fix).toContain("_meta.ui.csp.baseUriDomains");
    expect(f.fix).not.toContain("openai/widgetCSP");
  });

  it("redirect fix references only the OpenAI shape", () => {
    const html = `<script>openai.openExternal("https://docs.unknown.com")</script>`;
    const f = findFinding(findingsOf(html), "redirect")!;
    expect(f.fix).toContain("_meta.openai/widgetCSP.redirect_domains");
    expect(f.fix).not.toContain("_meta.ui.csp.redirectDomains");
  });

  it("includes mcpr.toml + per-widget paths under option B", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const f = findFinding(findingsOf(html), "script-src")!;
    expect(f.fix).toContain("[csp.resourceDomains].domains");
    expect(f.fix).toContain("[[csp.widget]] resourceDomains");
  });

  it("links to mcpr install/docs", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const f = findFinding(findingsOf(html), "script-src")!;
    expect(f.fix).toMatch(/github\.com\/[^\s]+\/mcpr/);
  });
});

describe("analyze - line numbers and snippets", () => {
  it("reports the line of the failing match (1-based)", () => {
    const html = [
      "<html>",
      "  <head>",
      '    <script src="https://cdn.unknown.com/x.js"></script>',
      "  </head>",
      "</html>",
    ].join("\n");
    const f = findFinding(findingsOf(html), "script-src")!;
    expect(f.line).toBe(3);
  });

  it("inlines a 5-line snippet centered on the failing line", () => {
    const html = [
      "<html>",
      "  <head>",
      '    <script src="https://cdn.unknown.com/x.js"></script>',
      "  </head>",
      "</html>",
    ].join("\n");
    const f = findFinding(findingsOf(html), "script-src")!;
    expect(f.snippet).toBeDefined();
    expect(f.snippet!.lines.length).toBeGreaterThan(0);
    const hit = f.snippet!.lines[f.snippet!.highlightIdx];
    expect(hit.num).toBe(3);
    expect(hit.text).toContain("script src");
  });

  it("clamps snippet to file boundaries for hits at line 1", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>\n<p>ok</p>`;
    const f = findFinding(findingsOf(html), "script-src")!;
    expect(f.snippet!.lines[0].num).toBe(1);
    expect(f.snippet!.highlightIdx).toBe(0);
  });
});

describe("analyze - report shape", () => {
  it("echoes the domains it ran against", () => {
    const domains = withDomains({ connectDomains: ["api.example.com"] });
    const report = analyze("<p>x</p>", domains);
    expect(report.domains).toEqual(domains);
  });
});
