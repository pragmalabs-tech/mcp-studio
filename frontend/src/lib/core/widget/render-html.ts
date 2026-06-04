import { extractCspDomains } from "@/lib/core/csp/profiles";
import type { CspDomains } from "@/lib/core/csp/types";
import type { MockData } from "@/lib/studio/mock-openai";
import { buildInjectedHtml } from "./injections";

export type WidgetPlatform = "openai" | "claude";

export interface RenderOpts {
  html: string;
  mock: MockData;
  platform: WidgetPlatform;
  strict: boolean;
  /** Rewrites tunnel URLs to this base. Pass the local proxy URL for live
   *  render so sandboxed iframes can fetch widget assets without CORS. */
  baseUrl?: string;
  /** Recorder bridge script source. When set and `strict` is false,
   *  injected into the iframe so DOM events flow back to the recorder.
   *  Strict CSP would block the bridge, so it is silently skipped. */
  bridgeSource?: string;
  /** Display-only mode for replay/review: blocks pointer + keyboard input
   *  so reviewers can read the widget without firing submit handlers. */
  viewOnly?: boolean;
}

export interface RenderResult {
  html: string;
  cspDomains: CspDomains;
}

export function renderHtml(opts: RenderOpts): RenderResult {
  const cspDomains = extractCspDomains(
    (opts.mock._meta || {}) as Record<string, unknown>,
  );
  return { html: buildInjectedHtml(opts.html, opts), cspDomains };
}
