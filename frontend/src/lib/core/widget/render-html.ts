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
  /** Display-only mode for replay/review: blocks pointer + keyboard input
   *  so reviewers can read the widget without firing submit handlers. */
  viewOnly?: boolean;
}

export interface RenderResult {
  html: string;
  cspDomains: CspDomains;
}

export function renderHtml(opts: RenderOpts): RenderResult {
  const { html, mock, platform, strict, baseUrl, bridgeSource, viewOnly } =
    opts;
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

  if (viewOnly) {
    scripts.push(viewOnlyScript());
  }

  const finalHtml = inject(html, {
    rewriteTunnel: baseUrl,
    metas,
    scripts,
  });
  return { html: finalHtml, cspDomains };
}

/** Blocks all user interaction inside the widget. Used by the trace review
 *  pane so reviewers can read the captured widget without firing submits,
 *  toggling state, or otherwise drifting the snapshot. Text remains
 *  selectable so reviewers can copy values. */
function viewOnlyScript(): string {
  return `<script>
(function () {
  var style = document.createElement('style');
  style.textContent = 'html,body{pointer-events:none!important;}body *{user-select:text!important;-webkit-user-select:text!important;cursor:default!important;}';
  (document.head || document.documentElement).appendChild(style);
  var swallow = function (e) { e.stopPropagation(); e.preventDefault(); };
  ['click','dblclick','mousedown','mouseup','keydown','keypress','keyup','submit','change','input','pointerdown','pointerup','touchstart','touchend']
    .forEach(function (t) { window.addEventListener(t, swallow, true); });
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input,select,textarea,button').forEach(function (el) {
      try { el.disabled = true; } catch (_) {}
      el.setAttribute('tabindex', '-1');
    });
  });
})();
</script>`;
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
