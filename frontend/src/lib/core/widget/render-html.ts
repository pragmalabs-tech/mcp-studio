/**
 * Compose widget srcdoc HTML for a given context (live render, replay,
 * dialog preview). Pure - returns the final HTML string + the CSP
 * domains that the policy was built against.
 *
 * Knows the policy:
 *   - strict: inject CSP meta + sandbox trap
 *   - relaxed: skip both
 *   - openai platform: inject `window.openai` mock
 *   - claude platform: inject link interceptor
 *   - bridgeSource present + !strict: inject recorder bridge
 */

import { buildCspMetaTag, extractCspDomains } from "@/lib/core/csp/profiles";
import { buildSandboxTrap } from "@/lib/core/csp/sandbox-trap";
import type { CspDomains } from "@/lib/core/csp/types";
import { buildOpenAIMockScript, type MockData } from "@/lib/studio/mock-openai";
import { inject } from "./inject";

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
}

export interface RenderResult {
  html: string;
  cspDomains: CspDomains;
}

export function renderHtml(opts: RenderOpts): RenderResult {
  const { html, mock, platform, strict, baseUrl, bridgeSource } = opts;
  const meta = (mock._meta || {}) as Record<string, unknown>;
  const cspDomains = extractCspDomains(meta);

  const metas: string[] = [];
  const scripts: string[] = [];

  if (strict) {
    metas.push(buildCspMetaTag(platform, cspDomains));
    scripts.push(buildSandboxTrap());
  }

  if (bridgeSource && !strict) {
    scripts.push(`<script>${bridgeSource}</script>`);
  }

  if (platform === "openai") {
    scripts.push(buildOpenAIMockScript(mock));
  } else {
    scripts.push(claudeLinkInterceptScript());
  }

  const finalHtml = inject(html, {
    rewriteTunnel: baseUrl,
    metas,
    scripts,
  });
  return { html: finalHtml, cspDomains };
}

/** Routes anchor clicks through `ui/open-link` so Claude's host opens the
 *  URL externally instead of letting the sandboxed iframe navigate. */
function claudeLinkInterceptScript(): string {
  return `<script>
document.addEventListener('click', function(e) {
  var target = e.target;
  while (target && target.tagName !== 'A') target = target.parentElement;
  if (target && target.href && target.href !== '#' && !target.href.startsWith('javascript:')) {
    e.preventDefault();
    var id = '__link_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    window.parent.postMessage({ jsonrpc: '2.0', id: id, method: 'ui/open-link', params: { url: target.href } }, '*');
  }
}, true);
</script>`;
}
