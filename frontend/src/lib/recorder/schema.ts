export const SCHEMA_VERSION = 1 as const;

export type Source = "user" | "widget";

export type Platform = "openai" | "claude";

export type Viewport = { preset: string } | { width: number; height: number };

export interface SetupConfig {
  platform: Platform;
  theme: string;
  displayMode: string;
  locale: string;
  viewport: Viewport;
  strictMode: boolean;
}

export type AuthBlock =
  | { method: "oauth"; token: string }
  | { method: "bearer"; token: string }
  | { method: "custom"; headers: Record<string, string> };

export interface SetupConnect {
  url: string;
  auth: AuthBlock;
}

export interface SelectorChain {
  testid?: string;
  aria?: { label?: string; role?: string };
  text?: { tag: string; value: string };
  css?: string;
  xpath?: string;
}

export type Action =
  | {
      kind: "sidebar.select";
      selection: { type: "tool" | "resource"; name: string };
    }
  | { kind: "editor.set_args"; value: unknown }
  | { kind: "config.update"; patch: Partial<SetupConfig> }
  | { kind: "auth.update"; patch: Partial<AuthBlock> }
  | {
      kind: "mcp.request";
      id: number;
      source: Source;
      method: string;
      params: unknown;
    }
  | {
      kind: "mcp.response";
      requestId: number;
      result?: unknown;
      error?: { message: string };
      durationMs: number;
    }
  | { kind: "mcp.notification"; method: string; params: unknown }
  | {
      kind: "widget.render";
      name: string;
      htmlHash: string;
      initialMock: unknown;
    }
  | { kind: "widget.mock.set"; value: unknown }
  | { kind: "widget.intent"; name: string; params: unknown }
  | {
      kind: "widget.dom.click";
      selectors: SelectorChain;
      mutated: boolean;
    }
  | {
      kind: "widget.dom.input";
      selectors: SelectorChain;
      value: string;
      inputType: string;
    }
  | {
      kind: "widget.dom.change";
      selectors: SelectorChain;
      value: string;
    }
  | { kind: "widget.dom.submit"; selectors: SelectorChain }
  | {
      kind: "widget.dom.keydown";
      selectors: SelectorChain;
      key: string;
      code: string;
      mods: number;
    }
  | {
      kind: "csp.violation";
      directive: string;
      blockedUri: string;
      severity: string;
    };

export type ActionKind = Action["kind"];

export type Recorded = { relMs: number } & Action;

export interface SessionWidget {
  name: string;
  html: string;
  initialMock: unknown;
}

export interface Session {
  version: typeof SCHEMA_VERSION;
  capturedAt: string;
  studioVersion: string;
  setup: { connect: SetupConnect; config: SetupConfig };
  widget?: SessionWidget;
  timeline: Recorded[];
}

export const REDACTED_TOKEN = "<<from-env>>" as const;

const ALLOWED_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "sidebar.select",
  "editor.set_args",
  "config.update",
  "auth.update",
  "mcp.request",
  "mcp.response",
  "mcp.notification",
  "widget.render",
  "widget.mock.set",
  "widget.intent",
  "widget.dom.click",
  "widget.dom.input",
  "widget.dom.change",
  "widget.dom.submit",
  "widget.dom.keydown",
  "csp.violation",
]);

export function isKnownActionKind(kind: string): kind is ActionKind {
  return ALLOWED_KINDS.has(kind as ActionKind);
}

export function validateSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Session>;
  if (s.version !== SCHEMA_VERSION) return false;
  if (typeof s.capturedAt !== "string") return false;
  if (typeof s.studioVersion !== "string") return false;
  if (!s.setup || typeof s.setup !== "object") return false;
  if (!Array.isArray(s.timeline)) return false;
  for (const a of s.timeline) {
    if (!a || typeof a !== "object") return false;
    if (typeof (a as Recorded).relMs !== "number") return false;
    if (!isKnownActionKind((a as Recorded).kind)) return false;
  }
  return true;
}
