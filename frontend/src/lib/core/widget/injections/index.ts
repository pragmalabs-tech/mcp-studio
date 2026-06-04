import type { RenderOpts } from "../render-html";
import { inject } from "../inject";
import { extractCspDomains } from "@/lib/core/csp/profiles";
import { cspMetaInjection } from "./csp-meta";
import { sandboxTrapInjection } from "./sandbox-trap";
import { recorderBridgeInjection } from "./recorder-bridge";
import { consoleForwarderInjection } from "./console-forwarder";
import { contentHeightInjection } from "./content-height";
import { openaiMockInjection } from "./openai-mock";
import { claudeLinkInterceptInjection } from "./claude-link-intercept";
import { viewOnlyInjection } from "./view-only";
import { captureEventsInjection } from "./capture-events";
import type { Injection } from "./types";

export type { Injection };

export const INJECTIONS: Injection[] = [
  cspMetaInjection,
  sandboxTrapInjection,
  recorderBridgeInjection,
  consoleForwarderInjection,
  contentHeightInjection,
  captureEventsInjection,
  openaiMockInjection,
  claudeLinkInterceptInjection,
  viewOnlyInjection,
];

export function buildInjectedHtml(html: string, opts: RenderOpts): string {
  const active = INJECTIONS.filter((inj) => inj.when(opts));
  const metas = active
    .filter((i) => i.type === "meta")
    .map((i) => i.build(opts));
  const scripts = active
    .filter((i) => i.type === "script")
    .map((i) => i.build(opts));
  return inject(html, { rewriteTunnel: opts.baseUrl, metas, scripts });
}

export { extractCspDomains };
