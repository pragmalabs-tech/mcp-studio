import { buildCspMetaTag, extractCspDomains } from "@/lib/core/csp/profiles";
import type { Injection } from "./types";

export const cspMetaInjection: Injection = {
  id: "csp-meta",
  name: "CSP Policy",
  type: "meta",
  when: (opts) => opts.strict,
  build: (opts) => {
    const meta = (opts.mock._meta || {}) as Record<string, unknown>;
    return buildCspMetaTag(opts.platform, extractCspDomains(meta));
  },
};
