/**
 * Shared CSP types used by the analyzer, profile builders, and the
 * studio's runtime violation panel.
 */

export type Severity = "error" | "warning";

/**
 * Platform names shown to the user in violation messages. Distinct from
 * the internal platform identifier (`"openai" | "claude"`); these are the
 * display labels.
 */
export type ViolationPlatform = "ChatGPT" | "Claude";

export interface SnippetLine {
  /** 1-based source line number. */
  num: number;
  text: string;
}

export interface Snippet {
  lines: SnippetLine[];
  /** Index of the failing line within `lines`. */
  highlightIdx: number;
}

/** A single CSP finding produced by `analyze()`. */
export interface CspFinding {
  severity: Severity;
  /** Which directive would block this (or sandbox sub-category). */
  directive: string;
  description: string;
  /** The problematic URL or code snippet. */
  blocked: string;
  /** How to fix it. */
  fix: string;
  /** Which platforms this affects. */
  platforms: ViolationPlatform[];
  /** Source line number, 1-based. 0 means "unknown". */
  line: number;
  /** Optional column, reserved for runtime mapping. */
  column?: number;
  /** Source context surrounding the failing line (inlined per finding). */
  snippet?: Snippet;
}

export interface CspDomains {
  connectDomains: string[];
  resourceDomains: string[];
  /** MCP Apps spec only — `_meta.ui.csp.baseUriDomains`. */
  baseUriDomains: string[];
  /** OpenAI Apps SDK only — `_meta.openai/widgetCSP.redirect_domains`. */
  redirectDomains: string[];
}

export interface CspReport {
  findings: CspFinding[];
  /** The domains the analyzer ran against (echoed back for callers). */
  domains: CspDomains;
}
