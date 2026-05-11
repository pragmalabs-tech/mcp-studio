/**
 * HTML head-injection mechanics. Pure - treats every input as text.
 *
 * Does not know what CSP is or what a "bridge" is. Higher layers
 * (`render-html.ts`) compose the right set of strings; this module
 * just splices them into `<head>` and optionally rewrites tunnel URLs.
 *
 * Fixed-order operations:
 *   1. tunnel-rewrite
 *   2. each entry in `metas` (in order)
 *   3. each entry in `scripts` (in order)
 *
 * All injections use the same `<head>`-replace pattern, so the LAST
 * item injected ends up FIRST inside `<head>`. Callers that care about
 * absolute ordering should reverse their lists accordingly.
 */

export interface InjectOpts {
  /**
   * When set, replaces `https?://*.tunnel.mcpr.app` occurrences with this
   * base URL. Applied before any head injection.
   */
  rewriteTunnel?: string;
  /** Each entry must be a complete `<meta ...>` tag. */
  metas?: string[];
  /** Each entry must be a complete `<script>...</script>` block. */
  scripts?: string[];
}

const TUNNEL_RE = /https?:\/\/[a-z0-9]+\.tunnel\.mcpr\.app/gi;
const HEAD_OPEN_RE = /<head([^>]*)>/i;

export function inject(html: string, opts: InjectOpts): string {
  let out = html;
  if (opts.rewriteTunnel !== undefined) {
    out = out.replace(TUNNEL_RE, opts.rewriteTunnel);
  }
  for (const meta of opts.metas ?? []) {
    out = out.replace(HEAD_OPEN_RE, `<head$1>${meta}`);
  }
  for (const script of opts.scripts ?? []) {
    out = out.replace(HEAD_OPEN_RE, `<head$1>${script}`);
  }
  return out;
}

/**
 * Strip tunnel URLs back to relative paths. Useful before static analysis
 * so the analyzer sees what the developer wrote, not the rewritten URLs.
 */
export function stripTunnelUrls(html: string): string {
  return html.replace(TUNNEL_RE, "");
}
