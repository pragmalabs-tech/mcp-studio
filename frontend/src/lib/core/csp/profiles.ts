/**
 * CSP profile definitions for ChatGPT and Claude widget sandboxes.
 *
 * When strict mode is on, we inject a <meta http-equiv="Content-Security-Policy">
 * tag into the widget HTML that mirrors what the real platform enforces.
 * If a widget works under strict mode it will work in production.
 */

import type { CspDomains } from "./types";

export interface CspProfile {
  name: string;
  build(domains: CspDomains): string;
  /** Sandbox attribute value for the iframe. */
  sandbox: string;
}

function dirs(base: string[], extra: string[]): string {
  const all = [...new Set([...base, ...extra])];
  return all.length > 0 ? " " + all.join(" ") : "";
}

/**
 * ChatGPT CSP profile.
 *
 * OpenAI hosts widgets in a sandboxed iframe with a restrictive CSP.
 * - No eval, no dynamic script loading from arbitrary origins
 * - connect-src restricted to declared connect_domains
 * - img/font/style/media restricted to declared resource_domains
 * - Inline scripts and styles are allowed (srcdoc requires it)
 */
export const chatgptProfile: CspProfile = {
  name: "ChatGPT",
  sandbox: "allow-scripts allow-same-origin allow-popups allow-forms",
  build({ connectDomains, resourceDomains }: CspDomains): string {
    const connect = dirs(connectDomains, []);
    const resource = dirs(resourceDomains, []);
    return [
      "default-src 'none'",
      `script-src 'unsafe-inline'${resource}`,
      `style-src 'unsafe-inline'${resource}`,
      `img-src data: blob:${resource}`,
      `font-src data:${resource}`,
      `connect-src${connect}`,
      `media-src blob:${resource}`,
      "worker-src blob:",
      "child-src blob:",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  },
};

/**
 * Claude CSP profile.
 *
 * Claude hosts MCP Apps via `srcdoc` iframe with `allow-scripts`. Inline
 * scripts run (the standard MCP Apps postMessage bridge ships inline);
 * `script-src` is not restricted to a claude.ai-only allow-list. The
 * directives Claude actually enforces tightly are `frame-src` and
 * `connect-src` (per issue #40 in claude-ai-mcp).
 */
export const claudeProfile: CspProfile = {
  name: "Claude",
  sandbox: "allow-scripts allow-same-origin allow-popups allow-forms",
  build({ connectDomains, resourceDomains }: CspDomains): string {
    const connect = dirs(connectDomains, []);
    const resource = dirs(resourceDomains, []);
    return [
      "default-src 'none'",
      `script-src 'unsafe-inline'${resource}`,
      `style-src 'unsafe-inline'${resource}`,
      `img-src data: blob:${resource}`,
      `font-src data:${resource}`,
      `connect-src${connect}`,
      `media-src blob:${resource}`,
      "worker-src blob:",
      "child-src blob:",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  },
};

export function getProfile(platform: "openai" | "claude"): CspProfile {
  return platform === "openai" ? chatgptProfile : claudeProfile;
}

/**
 * Extract CSP domains from widget metadata. Supports both OpenAI and
 * Claude (MCP Apps) shapes; entries appearing in both are deduped.
 */
export function extractCspDomains(meta: Record<string, unknown>): CspDomains {
  const result: CspDomains = {
    connectDomains: [],
    resourceDomains: [],
    baseUriDomains: [],
    redirectDomains: [],
  };

  const pushStrings = (target: string[], arr: unknown) => {
    if (!Array.isArray(arr)) return;
    target.push(...arr.filter((d): d is string => typeof d === "string"));
  };

  // OpenAI format: meta["openai/widgetCSP"].{connect,resource,redirect}_domains
  const widgetCSP = meta["openai/widgetCSP"] as
    | Record<string, unknown>
    | undefined;
  if (widgetCSP && typeof widgetCSP === "object") {
    pushStrings(result.connectDomains, widgetCSP.connect_domains);
    pushStrings(result.resourceDomains, widgetCSP.resource_domains);
    pushStrings(result.redirectDomains, widgetCSP.redirect_domains);
  }

  // MCP Apps / Claude format: meta.ui.csp.{connect,resource,baseUri}Domains
  const ui = meta.ui as Record<string, unknown> | undefined;
  const csp =
    ui && typeof ui === "object"
      ? (ui.csp as Record<string, unknown> | undefined)
      : undefined;
  if (csp && typeof csp === "object") {
    pushStrings(result.connectDomains, csp.connectDomains);
    pushStrings(result.resourceDomains, csp.resourceDomains);
    pushStrings(result.baseUriDomains, csp.baseUriDomains);
  }

  result.connectDomains = [...new Set(result.connectDomains)];
  result.resourceDomains = [...new Set(result.resourceDomains)];
  result.baseUriDomains = [...new Set(result.baseUriDomains)];
  result.redirectDomains = [...new Set(result.redirectDomains)];

  return result;
}

export function buildCspMetaTag(
  platform: "openai" | "claude",
  domains: CspDomains,
): string {
  const csp = getProfile(platform).build(domains);
  return `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
}

export function buildCspString(
  platform: "openai" | "claude",
  domains: CspDomains,
): string {
  return getProfile(platform).build(domains);
}
