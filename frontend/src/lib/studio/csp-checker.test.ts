import { describe, expect, it } from "vitest";
import { analyzeHtml, isAllowed, type CspIssue } from "./csp-checker";
import type { CspDomains } from "./csp-profiles";

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

const findIssue = (issues: CspIssue[], directive: string) =>
  issues.find((i) => i.directive === directive);

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

describe("analyzeHtml — script rules", () => {
  it("flags external <script src> not in resourceDomains", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const issues = analyzeHtml(html, emptyDomains());
    const issue = findIssue(issues, "script-src");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
    expect(issue!.fix).toContain("mcpr.toml");
    expect(issue!.fix).toContain("resourceDomains");
  });

  it("allows external <script src> when host is in resourceDomains", () => {
    const html = `<script src="https://cdn.example.com/x.js"></script>`;
    const issues = analyzeHtml(
      html,
      withDomains({ resourceDomains: ["cdn.example.com"] }),
    );
    expect(findIssue(issues, "script-src")).toBeUndefined();
  });

  it("flags relative <script src> as error regardless of domains", () => {
    const html = `<script src="/assets/main.js"></script>`;
    const issues = analyzeHtml(
      html,
      withDomains({ resourceDomains: ["cdn.example.com"] }),
    );
    const errs = issues.filter(
      (i) => i.directive === "script-src" && i.severity === "error",
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag inline <script> blocks (regression: false-positive removed)", () => {
    const html = `<script>let x = 1; window.postMessage({}, "*");</script>`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(issues.filter((i) => i.directive === "script-src")).toHaveLength(0);
  });
});

describe("analyzeHtml — stylesheet rules", () => {
  it("flags external <link rel=stylesheet> not in resourceDomains", () => {
    const html = `<link rel="stylesheet" href="https://cdn.unknown.com/x.css">`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(findIssue(issues, "style-src")).toBeDefined();
  });

  it("allows external stylesheet when host is in resourceDomains", () => {
    const html = `<link rel="stylesheet" href="https://cdn.example.com/x.css">`;
    const issues = analyzeHtml(
      html,
      withDomains({ resourceDomains: ["cdn.example.com"] }),
    );
    expect(findIssue(issues, "style-src")).toBeUndefined();
  });

  it("flags relative stylesheet href", () => {
    const html = `<link rel="stylesheet" href="/styles.css">`;
    const issues = analyzeHtml(html, emptyDomains());
    const errs = issues.filter(
      (i) => i.directive === "style-src" && i.severity === "error",
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("analyzeHtml — image rule", () => {
  it("flags external <img src> not in resourceDomains", () => {
    const html = `<img src="https://cdn.unknown.com/pic.png">`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(findIssue(issues, "img-src")).toBeDefined();
  });

  it("allows external <img src> when host is in resourceDomains", () => {
    const html = `<img src="https://cdn.example.com/pic.png">`;
    const issues = analyzeHtml(
      html,
      withDomains({ resourceDomains: ["cdn.example.com"] }),
    );
    expect(findIssue(issues, "img-src")).toBeUndefined();
  });
});

describe("analyzeHtml — eval / new Function", () => {
  it("flags eval()", () => {
    const html = `<script>eval("1+1")</script>`;
    const issues = analyzeHtml(html, emptyDomains());
    const issue = issues.find((i) => i.blocked === "eval(...)");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });

  it("flags new Function()", () => {
    const html = `<script>const f = new Function("return 1");</script>`;
    const issues = analyzeHtml(html, emptyDomains());
    const issue = issues.find((i) => i.blocked === "new Function(...)");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
  });
});

describe("analyzeHtml — fetch / XHR", () => {
  it("flags fetch() to host not in connectDomains", () => {
    const html = `<script>fetch("https://api.unknown.com/v1")</script>`;
    const issues = analyzeHtml(html, emptyDomains());
    const issue = findIssue(issues, "connect-src");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.fix).toContain("connectDomains");
  });

  it("allows fetch() when host is in connectDomains", () => {
    const html = `<script>fetch("https://api.example.com/v1")</script>`;
    const issues = analyzeHtml(
      html,
      withDomains({ connectDomains: ["api.example.com"] }),
    );
    expect(findIssue(issues, "connect-src")).toBeUndefined();
  });

  it("allows fetch() under wildcard subdomain", () => {
    const html = `<script>fetch("https://api.foo.example.com/v1")</script>`;
    const issues = analyzeHtml(
      html,
      withDomains({ connectDomains: ["*.example.com"] }),
    );
    expect(findIssue(issues, "connect-src")).toBeUndefined();
  });
});

describe("analyzeHtml — CSS url()", () => {
  it("flags url() pointing to host not in resourceDomains", () => {
    const html = `<style>@font-face { src: url("https://cdn.unknown.com/f.woff"); }</style>`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(findIssue(issues, "font-src / style-src")).toBeDefined();
  });
});

describe("analyzeHtml — iframe / object / embed", () => {
  it("flags <iframe> as error", () => {
    const html = `<iframe src="x"></iframe>`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(findIssue(issues, "frame-src")).toBeDefined();
  });

  it("flags <object> as error", () => {
    const html = `<object data="x"></object>`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(findIssue(issues, "object-src")).toBeDefined();
  });

  it("flags <embed> as error", () => {
    const html = `<embed src="x">`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(findIssue(issues, "object-src")).toBeDefined();
  });
});

describe("analyzeHtml — base-uri (MCP spec)", () => {
  it("flags <base href> with absolute URL not in baseUriDomains", () => {
    const html = `<base href="https://cdn.unknown.com/">`;
    const issues = analyzeHtml(html, emptyDomains());
    const issue = findIssue(issues, "base-uri");
    expect(issue).toBeDefined();
    expect(issue!.fix).toContain("baseUriDomains");
    expect(issue!.fix).toContain("mcpr.toml");
  });

  it("allows <base href> when host is in baseUriDomains", () => {
    const html = `<base href="https://cdn.example.com/">`;
    const issues = analyzeHtml(
      html,
      withDomains({ baseUriDomains: ["cdn.example.com"] }),
    );
    expect(findIssue(issues, "base-uri")).toBeUndefined();
  });

  it("does NOT flag relative <base href>", () => {
    const html = `<base href="./assets/">`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(findIssue(issues, "base-uri")).toBeUndefined();
  });
});

describe("analyzeHtml — openExternal redirect (OpenAI)", () => {
  it("flags openExternal target not in redirectDomains", () => {
    const html = `<script>openai.openExternal("https://docs.unknown.com")</script>`;
    const issues = analyzeHtml(html, emptyDomains());
    const issue = findIssue(issues, "redirect");
    expect(issue).toBeDefined();
    expect(issue!.platforms).toEqual(["ChatGPT"]);
    expect(issue!.fix).toContain("redirectDomains");
  });

  it("allows openExternal when target is in redirectDomains", () => {
    const html = `<script>openai.openExternal("https://docs.example.com")</script>`;
    const issues = analyzeHtml(
      html,
      withDomains({ redirectDomains: ["docs.example.com"] }),
    );
    expect(findIssue(issues, "redirect")).toBeUndefined();
  });
});

describe("analyzeHtml — restricted browser APIs (data-driven)", () => {
  it("flags localStorage usage", () => {
    const html = `<script>localStorage.getItem("x")</script>`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(issues.find((i) => i.blocked === "localStorage")).toBeDefined();
  });

  it("flags getUserMedia()", () => {
    const html = `<script>navigator.mediaDevices.getUserMedia({})</script>`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(issues.find((i) => i.blocked === "getUserMedia()")).toBeDefined();
  });

  it("flags new PaymentRequest()", () => {
    const html = `<script>new PaymentRequest([], {})</script>`;
    const issues = analyzeHtml(html, emptyDomains());
    expect(
      issues.find((i) => i.blocked === "new PaymentRequest()"),
    ).toBeDefined();
  });
});

describe("analyzeHtml — fix message format", () => {
  it("leads with the server-side _meta path (works without mcpr)", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const issue = findIssue(analyzeHtml(html, emptyDomains()), "script-src")!;
    const lines = issue.fix.split("\n");
    expect(lines[0]).toMatch(/^Add /);
    // First option (A) must reference the server-side _meta path BEFORE
    // mentioning mcpr.toml.
    const aIdx = lines.findIndex((l) => l.includes("MCP server code"));
    const bIdx = lines.findIndex((l) => l.includes("mcpr proxy"));
    expect(aIdx).toBeGreaterThan(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it("includes both MCP-Apps and OpenAI _meta forms for non-baseUri/redirect directives", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const issue = findIssue(analyzeHtml(html, emptyDomains()), "script-src")!;
    expect(issue.fix).toContain("_meta.ui.csp.resourceDomains");
    expect(issue.fix).toContain("_meta.openai/widgetCSP.resource_domains");
  });

  it("baseUri fix references only the MCP Apps shape", () => {
    const html = `<base href="https://cdn.unknown.com/">`;
    const issue = findIssue(analyzeHtml(html, emptyDomains()), "base-uri")!;
    expect(issue.fix).toContain("_meta.ui.csp.baseUriDomains");
    expect(issue.fix).not.toContain("openai/widgetCSP");
  });

  it("redirect fix references only the OpenAI shape", () => {
    const html = `<script>openai.openExternal("https://docs.unknown.com")</script>`;
    const issue = findIssue(analyzeHtml(html, emptyDomains()), "redirect")!;
    expect(issue.fix).toContain("_meta.openai/widgetCSP.redirect_domains");
    expect(issue.fix).not.toContain("_meta.ui.csp.redirectDomains");
  });

  it("includes mcpr.toml + per-widget paths under option B", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const issue = findIssue(analyzeHtml(html, emptyDomains()), "script-src")!;
    expect(issue.fix).toContain("[csp.resourceDomains].domains");
    expect(issue.fix).toContain("[[csp.widget]] resourceDomains");
  });

  it("links to mcpr install/docs", () => {
    const html = `<script src="https://cdn.unknown.com/x.js"></script>`;
    const issue = findIssue(analyzeHtml(html, emptyDomains()), "script-src")!;
    expect(issue.fix).toMatch(/github\.com\/[^\s]+\/mcpr/);
  });
});

describe("analyzeHtml — line numbers", () => {
  it("reports the line of the failing match (1-based)", () => {
    const html = [
      "<html>",
      "  <head>",
      '    <script src="https://cdn.unknown.com/x.js"></script>',
      "  </head>",
      "</html>",
    ].join("\n");
    const issue = findIssue(analyzeHtml(html, emptyDomains()), "script-src")!;
    expect(issue.line).toBe(3);
  });
});
