/**
 * Static analysis scanner for common CSP violations in widget HTML.
 *
 * Runs before rendering to catch issues that would be blocked by
 * ChatGPT/Claude CSP policies. Each check returns actionable fix suggestions.
 */

import type { CspDomains } from "./csp-profiles";
import { RESTRICTED_APIS } from "./csp-restricted-apis";

export type Severity = "error" | "warning";
/**
 * Platform names shown to the user in violation messages. Distinct from the
 * internal platform identifier used elsewhere in studio (`"openai" |
 * "claude"`); these are the display labels.
 */
export type ViolationPlatform = "ChatGPT" | "Claude";

export interface CspIssue {
  severity: Severity;
  /** Which directive would block this */
  directive: string;
  /** What was detected */
  description: string;
  /** The problematic URL or code snippet */
  blocked: string;
  /** How to fix it */
  fix: string;
  /** Affects which platforms */
  platforms: ViolationPlatform[];
  /** Source line number (approximate, 1-based) */
  line?: number;
}

/** Extract the origin (scheme + host) from a URL string. */
function extractOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Parse a CSP source-expression entry into a comparable form.
 *
 * Accepts both schemed and bare hosts:
 *   - "https://api.example.com"  -> { scheme: "https", host: "api.example.com" }
 *   - "api.example.com"          -> { host: "api.example.com" }
 *   - "*.example.com"            -> { host: "*.example.com", isWildcard: true }
 */
function normalizeDomain(d: string): {
  host: string;
  scheme?: string;
  isWildcard: boolean;
} | null {
  const trimmed = d.trim();
  if (!trimmed) return null;
  const schemeMatch = trimmed.match(/^(https?):\/\/(.+?)\/?$/i);
  if (schemeMatch) {
    const host = schemeMatch[2];
    return {
      scheme: schemeMatch[1].toLowerCase(),
      host,
      isWildcard: host.startsWith("*."),
    };
  }
  return { host: trimmed, isWildcard: trimmed.startsWith("*.") };
}

function hostMatches(
  declaredHost: string,
  urlHost: string,
  isWildcard: boolean,
): boolean {
  if (isWildcard) {
    // "*.example.com" -> requires at least one label before ".example.com"
    const suffix = declaredHost.slice(1).toLowerCase();
    const lower = urlHost.toLowerCase();
    return lower.endsWith(suffix) && lower.length > suffix.length;
  }
  return declaredHost.toLowerCase() === urlHost.toLowerCase();
}

/**
 * Check whether `url` matches any entry in the declared CSP source list.
 *
 * Matches by host (case-insensitive). Schemed entries also enforce scheme;
 * bare-host entries match any scheme (mirrors the CSP source-expression
 * grammar where the scheme is optional). `*.host` wildcards are supported.
 */
export function isAllowed(url: string, domains: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const urlHost = parsed.hostname;
  const urlScheme = parsed.protocol.replace(":", "").toLowerCase();
  return domains.some((d) => {
    const n = normalizeDomain(d);
    if (!n) return false;
    if (n.scheme && n.scheme !== urlScheme) return false;
    return hostMatches(n.host, urlHost, n.isWildcard);
  });
}

/** Find approximate line number for a match index in source text. */
function lineOf(html: string, index: number): number {
  return html.slice(0, index).split("\n").length;
}

/**
 * Build the recommended fix for a domain-style violation.
 *
 * The server-side path (declaring CSP on the resource `_meta` directly)
 * works without any extra tooling, so it leads. mcpr is mentioned as an
 * optional centralized rewrite path - useful when you can't or don't want
 * to edit the upstream code, but it requires running mcpr in front of the
 * MCP server. baseUri is MCP-only and redirect is OpenAI-only, so the
 * upstream pointer reflects which shape carries it.
 */
function fixForDomain(
  directive: "connect" | "resource" | "baseUri" | "redirect",
  url: string,
): string {
  const origin = extractOrigin(url) || url;
  const directiveCamel = `${directive}Domains`;
  let upstreamLines: string[];
  switch (directive) {
    case "baseUri":
      upstreamLines = ["    _meta.ui.csp.baseUriDomains  (MCP Apps spec)"];
      break;
    case "redirect":
      upstreamLines = [
        "    _meta.openai/widgetCSP.redirect_domains  (ChatGPT)",
      ];
      break;
    default:
      upstreamLines = [
        `    _meta.ui.csp.${directiveCamel}  (Claude / MCP Apps)`,
        `    _meta.openai/widgetCSP.${directive}_domains  (ChatGPT)`,
      ];
  }
  return [
    `Add "${origin}" to your CSP. Options:`,
    `  A. In your MCP server code (works everywhere):`,
    ...upstreamLines,
    `  B. Or via mcpr proxy (centralized config, no code change):`,
    `    mcpr.toml -> [csp.${directiveCamel}].domains    (operator-wide)`,
    `    mcpr.toml -> [[csp.widget]] ${directiveCamel}   (per-widget)`,
    `    See: https://github.com/pragmalabs-tech/mcpr`,
  ].join("\n");
}

export function analyzeHtml(html: string, domains: CspDomains): CspIssue[] {
  const issues: CspIssue[] = [];
  const both: ("ChatGPT" | "Claude")[] = ["ChatGPT", "Claude"];

  // 1a. External script tags: <script src="https://...">
  const scriptSrcRe = /<script[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptSrcRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      issues.push({
        severity: "warning",
        directive: "script-src",
        description: "External script not in resource_domains",
        blocked: url,
        fix: fixForDomain("resource", url),
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 1b. Relative/absolute path script tags: <script src="/..."> or <script src="./...">
  // These break in sandboxed iframes because paths resolve against the sandbox origin, not your server.
  const scriptRelRe = /<script[^>]+src\s*=\s*["'](\.{0,2}\/[^"'\s>]+)/gi;
  while ((m = scriptRelRe.exec(html)) !== null) {
    const path = m[1];
    issues.push({
      severity: "error",
      directive: "script-src",
      description:
        "Relative path will not resolve in sandboxed iframe — bundle scripts inline or use absolute URLs",
      blocked: path,
      fix: "Option 1: Bundle inline using a build tool (e.g. vite-plugin-singlefile). Option 2: Serve via mcpr proxy — it auto-rewrites paths and handles CSP",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  // 1c. Inline <script>...</script> blocks intentionally NOT flagged.
  // Both ChatGPT and Claude render widgets in `srcdoc` iframes with
  // `allow-scripts`; inline scripts are how the standard postMessage bridge
  // ships in MCP Apps templates. Earlier versions of this scanner reported
  // them as Claude-blocked based on a stale model of Claude's effective CSP
  // (see issue #40 in claude-ai-mcp). Real Claude restricts `frame-src` and
  // `connect-src`, not `script-src`. Removed to avoid false positives.

  // 2a. External stylesheets: <link href="https://..." rel="stylesheet">
  const linkRe = /<link[^>]+href\s*=\s*["']?(https?:\/\/[^"'\s>]+)[^>]*>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const url = m[1];
    if (
      /rel\s*=\s*["']?stylesheet/i.test(tag) &&
      !isAllowed(url, domains.resourceDomains)
    ) {
      issues.push({
        severity: "warning",
        directive: "style-src",
        description: "External stylesheet not in resource_domains",
        blocked: url,
        fix: fixForDomain("resource", url),
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 2b. Relative/absolute path stylesheets: <link href="/..." rel="stylesheet">
  const linkRelRe = /<link[^>]+href\s*=\s*["'](\.{0,2}\/[^"'\s>]+)[^>]*>/gi;
  while ((m = linkRelRe.exec(html)) !== null) {
    const tag = m[0];
    const path = m[1];
    if (/rel\s*=\s*["']?stylesheet/i.test(tag)) {
      issues.push({
        severity: "error",
        directive: "style-src",
        description:
          "Relative path will not resolve in sandboxed iframe — bundle styles inline or use absolute URLs",
        blocked: path,
        fix: "Option 1: Bundle inline using a build tool (e.g. vite-plugin-singlefile). Option 2: Serve via mcpr proxy — it auto-rewrites paths and handles CSP",
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 3. External images: <img src="https://...">
  const imgRe = /<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      issues.push({
        severity: "warning",
        directive: "img-src",
        description: "External image not in resource_domains",
        blocked: url,
        fix: fixForDomain("resource", url),
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 4. eval() / new Function() usage
  const evalRe = /\beval\s*\(/g;
  while ((m = evalRe.exec(html)) !== null) {
    issues.push({
      severity: "error",
      directive: "script-src",
      description: "eval() is blocked — 'unsafe-eval' is not allowed",
      blocked: "eval(...)",
      fix: "Replace eval() with JSON.parse() or a safe alternative",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  const newFuncRe = /new\s+Function\s*\(/g;
  while ((m = newFuncRe.exec(html)) !== null) {
    issues.push({
      severity: "error",
      directive: "script-src",
      description: "new Function() is blocked — 'unsafe-eval' is not allowed",
      blocked: "new Function(...)",
      fix: "Rewrite to avoid dynamic code generation",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  // 5. fetch / XMLHttpRequest to external URLs (heuristic — look in inline scripts)
  const fetchRe =
    /(?:fetch|XMLHttpRequest)\s*\(\s*["'`](https?:\/\/[^"'`\s]+)/gi;
  while ((m = fetchRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.connectDomains)) {
      issues.push({
        severity: "error",
        directive: "connect-src",
        description: "Network request to unlisted domain",
        blocked: url,
        fix: fixForDomain("connect", url),
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 6. External fonts via @import or url() in <style> blocks
  const fontUrlRe = /url\s*\(\s*["']?(https?:\/\/[^"')\s]+)/gi;
  while ((m = fontUrlRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      issues.push({
        severity: "warning",
        directive: "font-src / style-src",
        description: "External resource URL not in resource_domains",
        blocked: url,
        fix: fixForDomain("resource", url),
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 7. <iframe> usage (frame-src 'none' blocks this)
  const iframeRe = /<iframe[\s>]/gi;
  while ((m = iframeRe.exec(html)) !== null) {
    issues.push({
      severity: "error",
      directive: "frame-src",
      description: "Nested iframes are blocked (frame-src 'none')",
      blocked: "<iframe>",
      fix: "Remove nested iframes — render content directly in the widget",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  // 8. <object> / <embed> usage
  const objectRe = /<(?:object|embed)[\s>]/gi;
  while ((m = objectRe.exec(html)) !== null) {
    issues.push({
      severity: "error",
      directive: "object-src",
      description: "Plugin embeds are blocked (object-src 'none')",
      blocked: m[0].trim(),
      fix: "Remove <object>/<embed> elements",
      platforms: both,
      line: lineOf(html, m.index),
    });
  }

  // 9a. <base href="..."> targets must be in baseUriDomains (MCP spec).
  // Relative hrefs change resolution but don't violate base-uri; only
  // absolute URLs need allow-listing.
  const baseHrefRe = /<base[^>]+href\s*=\s*["']?([^"'\s>]+)/gi;
  while ((m = baseHrefRe.exec(html)) !== null) {
    const target = m[1];
    if (
      /^https?:\/\//i.test(target) &&
      !isAllowed(target, domains.baseUriDomains)
    ) {
      issues.push({
        severity: "warning",
        directive: "base-uri",
        description: "<base href> target not in baseUriDomains",
        blocked: target,
        fix: fixForDomain("baseUri", target),
        platforms: both,
        line: lineOf(html, m.index),
      });
    }
  }

  // 9b. window.openai.openExternal(...) targets must be in redirectDomains
  // (OpenAI Apps SDK). Without an entry, ChatGPT shows a safe-link warning.
  const openExternalRe = /\bopenai\.openExternal\s*\(\s*["'`]([^"'`]+)/gi;
  while ((m = openExternalRe.exec(html)) !== null) {
    const target = m[1];
    if (
      /^https?:\/\//i.test(target) &&
      !isAllowed(target, domains.redirectDomains)
    ) {
      issues.push({
        severity: "warning",
        directive: "redirect",
        description:
          "openExternal target not in redirect_domains - host shows safe-link warning",
        blocked: target,
        fix: fixForDomain("redirect", target),
        platforms: ["ChatGPT"],
        line: lineOf(html, m.index),
      });
    }
  }

  // 10. Restricted API usage — storage, permissions, device access, navigation
  //    These are blocked or unwanted in sandboxed widget iframes on both
  //    platforms. Pattern data lives in `csp-restricted-apis.ts`.
  for (const api of RESTRICTED_APIS) {
    api.pattern.lastIndex = 0;
    while ((m = api.pattern.exec(html)) !== null) {
      // Skip if inside a comment.
      const ctx = html.slice(Math.max(0, m.index - 30), m.index);
      if (/\/\/\s*$/.test(ctx) || /\*\s*$/.test(ctx)) continue;

      issues.push({
        severity: api.severity,
        directive: api.category,
        description: api.description,
        blocked: api.name,
        fix: api.fix,
        platforms: api.platforms,
        line: lineOf(html, m.index),
      });
    }
  }

  return issues;
}
