/**
 * Static-analysis CSP scanner for widget HTML.
 *
 * Runs before rendering to catch issues that would be blocked by
 * ChatGPT/Claude CSP policies. Each finding carries an actionable fix
 * and a 5-line source snippet so consumers (live panel, replay viewer,
 * content dialog) can render it without a second pass over the HTML.
 */

import { RESTRICTED_APIS } from "./restricted-apis";
import type {
  CspDomains,
  CspFinding,
  CspReport,
  Snippet,
  ViolationPlatform,
} from "./types";

const BOTH_PLATFORMS: ViolationPlatform[] = ["ChatGPT", "Claude"];

function extractOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

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
    const suffix = declaredHost.slice(1).toLowerCase();
    const lower = urlHost.toLowerCase();
    return lower.endsWith(suffix) && lower.length > suffix.length;
  }
  return declaredHost.toLowerCase() === urlHost.toLowerCase();
}

/**
 * Check whether `url` matches any entry in the declared CSP source list.
 *
 * Matches by host (case-insensitive). Schemed entries also enforce
 * scheme; bare-host entries match any scheme (mirrors the CSP
 * source-expression grammar where the scheme is optional). `*.host`
 * wildcards are supported.
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

function lineOf(html: string, index: number): number {
  return html.slice(0, index).split("\n").length;
}

/** Build a 5-line snippet centered on `line` (1-based). */
function buildSnippet(html: string, line: number): Snippet | undefined {
  if (line <= 0) return undefined;
  const all = html.split("\n");
  const start = Math.max(0, line - 3);
  const end = Math.min(all.length, line + 2);
  const slice = all.slice(start, end);
  return {
    lines: slice.map((text, i) => ({ num: start + i + 1, text })),
    highlightIdx: line - 1 - start,
  };
}

/**
 * Heuristic: is the call at `matchIndex` wrapped in a `try { ... } catch`?
 *
 * Bundles often probe for eval availability with `try { new Function("") }
 * catch { ... }` (e.g. Zod's `allowsEval`). Under strict CSP the throw is
 * caught and the bundle falls back to a non-eval path, so flagging these
 * as errors is a false positive. We still surface them as warnings.
 */
function isGuardedByTryCatch(html: string, matchIndex: number): boolean {
  const WINDOW = 300;
  const before = html.slice(Math.max(0, matchIndex - WINDOW), matchIndex);
  const after = html.slice(matchIndex, matchIndex + WINDOW);
  return /\btry\s*\{/.test(before) && /\}\s*catch\b/.test(after);
}

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

/**
 * Scan widget HTML and produce a structured CSP report.
 *
 * Pure - no DOM, no fetch. Safe to call from any layer (live store,
 * replay viewer, content dialog).
 */
export function analyze(html: string, domains: CspDomains): CspReport {
  const findings: CspFinding[] = [];
  const push = (
    f: Omit<CspFinding, "snippet"> & { snippet?: Snippet },
  ): void => {
    findings.push({
      ...f,
      snippet: f.snippet ?? buildSnippet(html, f.line),
    });
  };

  let m: RegExpExecArray | null;

  // 1a. External script tags: <script src="https://...">
  const scriptSrcRe = /<script[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
  while ((m = scriptSrcRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      push({
        severity: "warning",
        directive: "script-src",
        description: "External script not in resource_domains",
        blocked: url,
        fix: fixForDomain("resource", url),
        platforms: BOTH_PLATFORMS,
        line: lineOf(html, m.index),
      });
    }
  }

  // 1b. Relative/absolute path script tags.
  const scriptRelRe = /<script[^>]+src\s*=\s*["'](\.{0,2}\/[^"'\s>]+)/gi;
  while ((m = scriptRelRe.exec(html)) !== null) {
    push({
      severity: "error",
      directive: "script-src",
      description:
        "Relative path will not resolve in sandboxed iframe - bundle scripts inline or use absolute URLs",
      blocked: m[1],
      fix: "Option 1: Bundle inline using a build tool (e.g. vite-plugin-singlefile). Option 2: Serve via mcpr proxy - it auto-rewrites paths and handles CSP",
      platforms: BOTH_PLATFORMS,
      line: lineOf(html, m.index),
    });
  }

  // 1c. Inline <script>...</script> blocks intentionally NOT flagged.

  // 2a. External stylesheets.
  const linkRe = /<link[^>]+href\s*=\s*["']?(https?:\/\/[^"'\s>]+)[^>]*>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const url = m[1];
    if (
      /rel\s*=\s*["']?stylesheet/i.test(tag) &&
      !isAllowed(url, domains.resourceDomains)
    ) {
      push({
        severity: "warning",
        directive: "style-src",
        description: "External stylesheet not in resource_domains",
        blocked: url,
        fix: fixForDomain("resource", url),
        platforms: BOTH_PLATFORMS,
        line: lineOf(html, m.index),
      });
    }
  }

  // 2b. Relative/absolute path stylesheets.
  const linkRelRe = /<link[^>]+href\s*=\s*["'](\.{0,2}\/[^"'\s>]+)[^>]*>/gi;
  while ((m = linkRelRe.exec(html)) !== null) {
    const tag = m[0];
    if (/rel\s*=\s*["']?stylesheet/i.test(tag)) {
      push({
        severity: "error",
        directive: "style-src",
        description:
          "Relative path will not resolve in sandboxed iframe - bundle styles inline or use absolute URLs",
        blocked: m[1],
        fix: "Option 1: Bundle inline using a build tool (e.g. vite-plugin-singlefile). Option 2: Serve via mcpr proxy - it auto-rewrites paths and handles CSP",
        platforms: BOTH_PLATFORMS,
        line: lineOf(html, m.index),
      });
    }
  }

  // 3. External images.
  const imgRe = /<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      push({
        severity: "warning",
        directive: "img-src",
        description: "External image not in resource_domains",
        blocked: url,
        fix: fixForDomain("resource", url),
        platforms: BOTH_PLATFORMS,
        line: lineOf(html, m.index),
      });
    }
  }

  // 4. eval() / new Function() usage.
  const evalRe = /\beval\s*\(/g;
  while ((m = evalRe.exec(html)) !== null) {
    const guarded = isGuardedByTryCatch(html, m.index);
    push({
      severity: guarded ? "warning" : "error",
      directive: "script-src",
      description: guarded
        ? "eval() found inside try/catch - appears to be a feature probe; will throw under strict CSP and the catch handles it"
        : "eval() is blocked - 'unsafe-eval' is not allowed",
      blocked: "eval(...)",
      fix: guarded
        ? "Likely safe: the catch swallows the CSP throw. Verify the fallback path works without eval, or remove the probe"
        : "Replace eval() with JSON.parse() or a safe alternative",
      platforms: BOTH_PLATFORMS,
      line: lineOf(html, m.index),
    });
  }

  const newFuncRe = /new\s+Function\s*\(/g;
  while ((m = newFuncRe.exec(html)) !== null) {
    const guarded = isGuardedByTryCatch(html, m.index);
    push({
      severity: guarded ? "warning" : "error",
      directive: "script-src",
      description: guarded
        ? "new Function() found inside try/catch - appears to be a feature probe; will throw under strict CSP and the catch handles it"
        : "new Function() is blocked - 'unsafe-eval' is not allowed",
      blocked: "new Function(...)",
      fix: guarded
        ? "Likely safe: the catch swallows the CSP throw. Verify the fallback path works without eval, or remove the probe"
        : "Rewrite to avoid dynamic code generation",
      platforms: BOTH_PLATFORMS,
      line: lineOf(html, m.index),
    });
  }

  // 5. fetch / XMLHttpRequest.
  const fetchRe =
    /(?:fetch|XMLHttpRequest)\s*\(\s*["'`](https?:\/\/[^"'`\s]+)/gi;
  while ((m = fetchRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.connectDomains)) {
      push({
        severity: "error",
        directive: "connect-src",
        description: "Network request to unlisted domain",
        blocked: url,
        fix: fixForDomain("connect", url),
        platforms: BOTH_PLATFORMS,
        line: lineOf(html, m.index),
      });
    }
  }

  // 6. External fonts via @import or url().
  const fontUrlRe = /url\s*\(\s*["']?(https?:\/\/[^"')\s]+)/gi;
  while ((m = fontUrlRe.exec(html)) !== null) {
    const url = m[1];
    if (!isAllowed(url, domains.resourceDomains)) {
      push({
        severity: "warning",
        directive: "font-src / style-src",
        description: "External resource URL not in resource_domains",
        blocked: url,
        fix: fixForDomain("resource", url),
        platforms: BOTH_PLATFORMS,
        line: lineOf(html, m.index),
      });
    }
  }

  // 7. <iframe> usage.
  const iframeRe = /<iframe[\s>]/gi;
  while ((m = iframeRe.exec(html)) !== null) {
    push({
      severity: "error",
      directive: "frame-src",
      description: "Nested iframes are blocked (frame-src 'none')",
      blocked: "<iframe>",
      fix: "Remove nested iframes - render content directly in the widget",
      platforms: BOTH_PLATFORMS,
      line: lineOf(html, m.index),
    });
  }

  // 8. <object> / <embed>.
  const objectRe = /<(?:object|embed)[\s>]/gi;
  while ((m = objectRe.exec(html)) !== null) {
    push({
      severity: "error",
      directive: "object-src",
      description: "Plugin embeds are blocked (object-src 'none')",
      blocked: m[0].trim(),
      fix: "Remove <object>/<embed> elements",
      platforms: BOTH_PLATFORMS,
      line: lineOf(html, m.index),
    });
  }

  // 9a. <base href> against baseUriDomains.
  const baseHrefRe = /<base[^>]+href\s*=\s*["']?([^"'\s>]+)/gi;
  while ((m = baseHrefRe.exec(html)) !== null) {
    const target = m[1];
    if (
      /^https?:\/\//i.test(target) &&
      !isAllowed(target, domains.baseUriDomains)
    ) {
      push({
        severity: "warning",
        directive: "base-uri",
        description: "<base href> target not in baseUriDomains",
        blocked: target,
        fix: fixForDomain("baseUri", target),
        platforms: BOTH_PLATFORMS,
        line: lineOf(html, m.index),
      });
    }
  }

  // 9b. openai.openExternal targets against redirectDomains.
  const openExternalRe = /\bopenai\.openExternal\s*\(\s*["'`]([^"'`]+)/gi;
  while ((m = openExternalRe.exec(html)) !== null) {
    const target = m[1];
    if (
      /^https?:\/\//i.test(target) &&
      !isAllowed(target, domains.redirectDomains)
    ) {
      push({
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

  // 10. Restricted API usage.
  for (const api of RESTRICTED_APIS) {
    api.pattern.lastIndex = 0;
    while ((m = api.pattern.exec(html)) !== null) {
      // Skip if inside a comment.
      const ctx = html.slice(Math.max(0, m.index - 30), m.index);
      if (/\/\/\s*$/.test(ctx) || /\*\s*$/.test(ctx)) continue;

      push({
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

  return { findings, domains };
}
