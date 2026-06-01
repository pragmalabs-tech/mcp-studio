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

  // Forward widget console output to the studio shell so developers can
  // copy log lines without opening devtools. Skipped under strict CSP
  // for the same reason as the bridge: inline scripts may be blocked.
  if (!strict) {
    scripts.push(consoleForwardScript());
    scripts.push(contentHeightScript());
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

/** Forwards `console.log/info/warn/error/debug` calls from the widget up
 *  to the studio shell via `postMessage`. The original console methods
 *  still fire so browser devtools keep working; we only piggyback on
 *  them. Args are safely serialized (circular refs become `[Circular]`,
 *  functions become `[Function]`, Errors include their stack) so the
 *  receiver can render plain strings. */
function consoleForwardScript(): string {
  return `<script>
(function () {
  var LEVELS = ['log','info','warn','error','debug'];
  function safeStringify(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v instanceof Error) return v.stack || (v.name + ': ' + v.message);
    try {
      var seen = new WeakSet();
      return JSON.stringify(v, function (_k, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        if (typeof val === 'function') return '[Function]';
        if (typeof val === 'bigint') return val.toString() + 'n';
        return val;
      });
    } catch (_e) {
      try { return String(v); } catch (_e2) { return '[Unserializable]'; }
    }
  }
  LEVELS.forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      try {
        var args = Array.prototype.map.call(arguments, safeStringify);
        window.parent.postMessage({ type: 'studio_console', level: level, args: args, time: Date.now() }, '*');
      } catch (_) { /* parent gone or cross-origin */ }
      try { original.apply(console, arguments); } catch (_) { /* ignore */ }
    };
  });
  // Surface uncaught errors and unhandled rejections too - they're the
  // most useful signal when a widget silently breaks.
  window.addEventListener('error', function (e) {
    try {
      var msg = e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '');
      window.parent.postMessage({ type: 'studio_console', level: 'error', args: [msg], time: Date.now() }, '*');
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var reason = e.reason;
      var msg = reason && reason.stack ? reason.stack : safeStringify(reason);
      window.parent.postMessage({ type: 'studio_console', level: 'error', args: ['Unhandled rejection: ' + msg], time: Date.now() }, '*');
    } catch (_) {}
  });
})();
</script>`;
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

/** Reports the actual rendered content height to the studio shell so the
 *  preview container can shrink-wrap the widget instead of leaving empty
 *  space when body/html have forced height:100%. Uses the bottom edge of
 *  body's children (not scrollHeight) to skip background-only space. */
function contentHeightScript(): string {
  return `<script>
(function () {
  function measure() {
    var max = 0;
    var children = document.body ? document.body.children : [];
    for (var i = 0; i < children.length; i++) {
      var b = children[i].getBoundingClientRect();
      if (b.bottom > max) max = b.bottom;
    }
    if (max > 10) {
      window.parent.postMessage({ type: 'studio_content_height', height: Math.ceil(max) }, '*');
    }
  }
  if (document.readyState === 'complete') {
    setTimeout(measure, 50);
  } else {
    window.addEventListener('load', function () { setTimeout(measure, 50); });
  }
  if (typeof ResizeObserver !== 'undefined' && document.body) {
    new ResizeObserver(measure).observe(document.body);
  }
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
