// import type { Action as ActionType } from "@/lib/action/types";

export const SCHEMA_VERSION = 2 as const;

// Backward compatibility exports (stub types for old code)
export type Source = "user" | "widget";
export type Recorded = RecordedAction; // Alias for compatibility
export type Action = any; // Stub for old code

export interface SelectorChain {
  testid?: string;
  aria?: { label?: string; role?: string };
  text?: { tag: string; value: string };
  css?: string;
  xpath?: string;
}

export type WidgetDomAction = any; // Stub for old widget code

export type AuthBlock =
  | { method: "oauth"; token: string }
  | { method: "bearer"; token: string }
  | { method: "custom"; headers: Record<string, string> };

export interface SetupConnect {
  url: string;
  auth: AuthBlock;
}

export type Viewport = { preset: string } | { width: number; height: number };

// Setup configuration
export interface SetupConfig {
  url: string;
  theme?: string;
  locale?: string;
  // Backward compatibility fields
  platform?: string;
  displayMode?: string;
  viewport?: Viewport;
  strictMode?: boolean;
}

// Recorded action with timing
// The action's toJSON() includes result if present
export interface RecordedAction {
  relMs: number;
  action: ReturnType<Action["toJSON"]>;
}

// Test session
export interface Session {
  version: typeof SCHEMA_VERSION;
  capturedAt: string;
  studioVersion: string;
  setup: SetupConfig;
  actions: RecordedAction[];
}

// User-saved test
export interface Test {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  session: Session;
}

// Test summary for catalog
export interface TestSummary {
  name: string;
  displayName?: string;
  description?: string;
  createdAt?: string;
  totalActions?: number;
  size: number;
  modifiedMs: number;
}

export function validateSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Session>;
  if (s.version !== SCHEMA_VERSION) return false;
  if (typeof s.capturedAt !== "string") return false;
  if (typeof s.studioVersion !== "string") return false;
  if (!s.setup || typeof s.setup !== "object") return false;
  if (!Array.isArray(s.actions)) return false;
  return true;
}
