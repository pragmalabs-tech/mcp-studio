import type { MockData } from "../mock-openai";
import type { Action } from "@/lib/action";
import type {
  Severity,
  Snippet,
  ViolationPlatform,
} from "@/lib/core/csp/types";
import type {
  OAuthServerMetadata,
  ComplianceCheck,
  DecodedToken,
} from "../oauth-debug";

export type Platform = "openai" | "claude";

export interface RunState {
  testName: string;
  mode: "auto" | "step";
  currentStep: number;
  totalSteps: number;
  currentAction: Action | null;
  ctrl: AbortController;
  nextResolver: (() => void) | null;
}

export type ViewportPreset = "desktop" | "tablet" | "mobile" | "custom";

export interface ViewportSize {
  width: number;
  height: number;
}

export const VIEWPORT_PRESETS: Record<
  Exclude<ViewportPreset, "custom">,
  ViewportSize
> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 430, height: 932 },
};

export type SelectedItem =
  | { type: "tool"; tool: import("../api").McpToolInfo }
  | { type: "resource"; resource: import("../api").McpResourceInfo }
  | { type: "widget"; name: string };

export interface ActionEntry {
  time: string;
  method: string;
  args: string;
}

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  time: string;
  level: ConsoleLevel;
  args: string[];
}

export interface PendingMessage {
  id: string;
  time: string;
  source: "openai" | "claude";
  content: unknown;
}

export interface Widget {
  id: string;
  originalHtml: string;
  injectedHtml: string;
  mock: MockData;
  waitMs: number;
  snapshot: string | null;
}

export type AuthMethod = "oauth" | "bearer" | "custom";

export type OAuthStatus =
  | "idle"
  | "discovering"
  | "registering"
  | "authorizing"
  | "exchanging"
  | "connected"
  | "error";

export interface OAuthState {
  status: OAuthStatus;
  metadata: OAuthServerMetadata | null;
  complianceChecks: ComplianceCheck[];
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  customHeaders: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string[];
  selectedScopes: string[];
  error: string | null;
  decodedToken: DecodedToken | null;
}

export interface CspViolation {
  id: string;
  time: string;
  directive: string;
  blockedUri: string;
  sourceFile: string;
  lineNumber: number;
  columnNumber: number;
  source: "runtime" | "static";
  fix?: string;
  severity: Severity;
  platforms?: ViolationPlatform[];
  snippet?: Snippet;
}
