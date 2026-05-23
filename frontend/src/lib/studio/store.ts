import { create } from "zustand";
import {
  getBaseUrl,
  setProxyUrl as apiSetProxyUrl,
  hasProxyUrl,
  getBearerToken,
  setBearerToken,
  getAuthMethod as readAuthMethod,
  setAuthMethod as writeAuthMethod,
  getCustomHeaders as readCustomHeaders,
  setCustomHeaders as writeCustomHeaders,
  saveOAuthTokens,
  loadOAuthTokens,
  clearOAuthTokens,
  savePKCEState as writePKCE,
  loadPKCEState as readPKCE,
  clearPKCEState as removePKCE,
  saveOAuthFlowState,
  resetSession,
  mcpInitialize,
  listTools,
  listResources,
  callTool,
  readResource,
  type McpToolInfo,
  type McpResourceInfo,
} from "./api";
import { DEFAULT_MOCK, type MockData } from "./mock-openai";
import { extractWidgetUri } from "./tool-category";
import { validateToolResult, type ResultIssue } from "./validate-tool-result";
import { ToolCallAction, ResourceReadAction, type Action } from "@/lib/action";
import { createClaudeMock } from "./mock-claude";

/** Payload shape consumed by `applyWidgetMock`. The studio's only widget
 *  mock surface — kept inline here so we don't reintroduce a stub types module. */
export interface WidgetMock {
  toolInput: unknown;
  toolOutput: unknown;
  meta: Record<string, unknown>;
  widgetState: unknown | null;
}
import { extractCspDomains } from "@/lib/core/csp/profiles";
import { analyze } from "@/lib/core/csp/analyze";
import type {
  CspFinding,
  Severity,
  Snippet,
  ViolationPlatform,
} from "@/lib/core/csp/types";
import { stripTunnelUrls } from "@/lib/core/widget/inject";
import type {
  OAuthDebugEvent,
  OAuthServerMetadata,
  ComplianceCheck,
} from "./oauth-debug";
import { checkCompliance, decodeToken, type DecodedToken } from "./oauth-debug";
import {
  discoverMetadata,
  resolveEndpoints,
  registerClient,
  buildAuthorizationUrl,
  exchangeCode,
  refreshAccessToken as oauthRefresh,
  generatePKCE,
  getRedirectUri,
  getAuthBaseUrl,
  testEndpoint,
} from "./oauth";
import {
  fetchAuthStatus,
  fetchTunnelStatus,
  authLogout,
  startTunnel as apiStartTunnel,
} from "./cloud-api";
import {
  listProfiles,
  activateProfile as apiActivateProfile,
  updateProfile as apiUpdateProfile,
  type Profile,
  type ProfileAuth,
} from "./profiles-api";
import { recorder } from "../recorder/bus";
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

// ── Types ──

export type Platform = "openai" | "claude";

/**
 * Live replay state. When non-null, a test is being replayed. The
 * TopHeader subscribes to render the run banner + controls. Step mode
 * pauses between actions and resumes via `nextResolver`; the replay
 * runner currently always uses `mode: "auto"`, with step support
 * preserved here for future use.
 */
export interface RunState {
  testName: string;
  mode: "auto" | "step";
  /** 0-indexed; -1 before the first step starts. */
  currentStep: number;
  totalSteps: number;
  currentAction: Action | null;
  ctrl: AbortController;
  /** Resolver while paused in step mode. null = not paused. */
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
  | { type: "tool"; tool: McpToolInfo }
  | { type: "resource"; resource: McpResourceInfo }
  | { type: "widget"; name: string };

export interface ActionEntry {
  time: string;
  method: string;
  args: string;
}

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  /** HH:MM:SS.mmm formatted timestamp; matches ActionEntry.time. */
  time: string;
  level: ConsoleLevel;
  /** Pre-stringified args from the widget. Joined with space at render. */
  args: string[];
}

export interface PendingMessage {
  id: string;
  time: string;
  source: "openai" | "claude";
  content: unknown;
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
  /** The directive that was violated (e.g. "script-src") */
  directive: string;
  /** The URI that was blocked */
  blockedUri: string;
  /** Source file where the violation occurred */
  sourceFile: string;
  /** Line number in source */
  lineNumber: number;
  /** Column number in source */
  columnNumber: number;
  /** Whether this came from runtime (browser) or static analysis */
  source: "runtime" | "static";
  /** Human-readable fix suggestion (for static issues) */
  fix?: string;
  /** Severity */
  severity: Severity;
  /** Which platforms are affected */
  platforms?: ViolationPlatform[];
  /** Source context for the failing line, inlined by the analyzer. */
  snippet?: Snippet;
}

// ── Helpers ──

/**
 * Convert a static-analysis `CspFinding` into the panel-shaped
 * `CspViolation`, stamping in the bookkeeping fields the finding doesn't
 * carry. Runtime sandbox violations build their own `CspViolation`
 * directly (different input shape, no finding to convert from).
 */
function toStaticViolation(
  finding: CspFinding,
  opts: { sourceFile: string },
): CspViolation {
  return {
    id: `static_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toTimeString().split(" ")[0],
    directive: finding.directive,
    blockedUri: finding.blocked,
    sourceFile: opts.sourceFile,
    lineNumber: finding.line || 0,
    columnNumber: 0,
    source: "static",
    fix: finding.fix,
    severity: finding.severity,
    platforms: finding.platforms,
    snippet: finding.snippet,
  };
}

function defaultEditorValue() {
  return JSON.stringify(
    {
      toolInput: DEFAULT_MOCK.toolInput,
      toolOutput: DEFAULT_MOCK.toolOutput,
      _meta: DEFAULT_MOCK._meta,
      widgetState: DEFAULT_MOCK.widgetState,
    },
    null,
    2,
  );
}

interface JsonSchemaProperty {
  type?: string;
  default?: unknown;
  examples?: unknown[];
  example?: unknown;
  enum?: unknown[];
  description?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  format?: string;
}

function sampleValue(key: string, prop: JsonSchemaProperty): unknown {
  if (prop.default !== undefined) return prop.default;
  if (prop.examples?.length) return prop.examples[0];
  if (prop.example !== undefined) return prop.example;
  if (prop.enum?.length) return prop.enum[0];

  if (prop.format === "date") return "2026-01-15";
  if (prop.format === "date-time") return "2026-01-15T10:30:00Z";
  if (prop.format === "email") return "user@example.com";
  if (prop.format === "uri" || prop.format === "url")
    return "https://example.com";
  if (prop.format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";

  if (prop.type === "string") {
    const k = key.toLowerCase();
    if (k.includes("name")) return "example";
    if (k.includes("id")) return "abc-123";
    if (k.includes("email")) return "user@example.com";
    if (k.includes("url") || k.includes("uri")) return "https://example.com";
    if (k.includes("lang") || k.includes("locale")) return "en-US";
    if (k.includes("query") || k.includes("search") || k.includes("question"))
      return "sample query";
    if (k.includes("message") || k.includes("text") || k.includes("content"))
      return "Hello world";
    if (k.includes("description")) return "A sample description";
    if (k.includes("title")) return "Sample Title";
    if (prop.description) return `<${prop.description}>`;
    return "example";
  }
  if (prop.type === "number" || prop.type === "integer") {
    if (prop.minimum !== undefined) return prop.minimum;
    if (prop.maximum !== undefined) return Math.min(prop.maximum, 10);
    return prop.type === "integer" ? 1 : 1.0;
  }
  if (prop.type === "boolean") return true;
  if (prop.type === "array") {
    if (prop.items) return [sampleValue("item", prop.items)];
    return [];
  }
  if (prop.type === "object") {
    if (prop.properties)
      return sampleFromProperties(prop.properties, prop.required);
    return {};
  }
  return null;
}

function sampleFromProperties(
  properties: Record<string, JsonSchemaProperty>,
  required?: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    result[key] = sampleValue(key, prop);
  }
  if (required?.length) {
    const ordered: Record<string, unknown> = {};
    for (const key of required) {
      if (key in result) ordered[key] = result[key];
    }
    for (const key of Object.keys(result)) {
      if (!(key in ordered)) ordered[key] = result[key];
    }
    return ordered;
  }
  return result;
}

function toolArgsFromSchema(schema?: Record<string, unknown>): string {
  if (!schema || !schema.properties) return "{}";
  const props = schema.properties as Record<string, JsonSchemaProperty>;
  const required = schema.required as string[] | undefined;
  return JSON.stringify(sampleFromProperties(props, required), null, 2);
}

function formatTimestamp(): string {
  const now = new Date();
  return (
    now.toTimeString().split(" ")[0] +
    "." +
    String(now.getMilliseconds()).padStart(3, "0")
  );
}

const PROFILE_AUTH_MIGRATION_FLAG = "studio:profile_auth_migrated_v1";

/**
 * Push a profile's auth into the localStorage origin-scoped cache that
 * `buildHeaders()` reads. Must run after `setProxyUrl(profile.server_url)`
 * so the underlying `studioKey()` resolves to the new origin.
 *
 * For the `oauth` marker, leaves origin-scoped OAuth tokens untouched
 * (those are written by the OAuth callback flow and survive across
 * profile activations sharing the same origin).
 */
function applyProfileAuthToLocalStorage(auth: ProfileAuth | undefined): void {
  if (!auth) return;
  switch (auth.method) {
    case "none":
      writeAuthMethod("oauth");
      setBearerToken("");
      writeCustomHeaders("");
      break;
    case "bearer":
      writeAuthMethod("bearer");
      setBearerToken(auth.token);
      break;
    case "custom":
      writeAuthMethod("custom");
      writeCustomHeaders(JSON.stringify(auth.headers));
      break;
    case "oauth":
      writeAuthMethod("oauth");
      break;
  }
}

/**
 * Resync the OAuth slice (panel state, decoded JWT, custom-headers draft)
 * from whatever the active origin's localStorage holds. Called after a
 * profile switch so stale tokens / compliance results from the previous
 * profile don't linger in the OAuth debugger panel.
 */
function snapshotOauthSliceFromOrigin(prev: OAuthState): OAuthState {
  const saved = loadOAuthTokens();
  const headersStr = JSON.stringify(readCustomHeaders());
  return {
    ...prev,
    status: saved.accessToken ? "connected" : "idle",
    metadata: null,
    complianceChecks: [],
    accessToken: saved.accessToken,
    refreshToken: saved.refreshToken,
    expiresAt: saved.expiresAt,
    clientId: saved.clientId || "",
    customHeaders: headersStr === "{}" ? "" : headersStr,
    error: null,
    decodedToken: saved.accessToken ? decodeToken(saved.accessToken) : null,
  };
}

/**
 * Read whatever auth is currently configured in localStorage for the active
 * origin and convert it into a `ProfileAuth`. Used by the one-shot migration
 * to seed profiles from pre-profile installs.
 */
function snapshotOriginAuthForMigration(): ProfileAuth | null {
  const method = readAuthMethod();
  if (method === "bearer") {
    const token = getBearerToken();
    if (token) return { method: "bearer", token };
  } else if (method === "custom") {
    const headers = readCustomHeaders();
    if (Object.keys(headers).length > 0) {
      return { method: "custom", headers };
    }
  } else if (method === "oauth") {
    if (loadOAuthTokens().accessToken) return { method: "oauth" };
  }
  return null;
}

// ── Store ──

interface StudioState {
  // Proxy connection
  proxyUrl: string;
  proxyConnected: boolean;
  setProxyUrl: (url: string) => void;

  // Profiles (MCP server targets + auth, persisted by the local backend)
  profiles: Profile[];
  activeProfileId: string | null;
  refreshProfiles: () => Promise<void>;
  activateAndApply: (id: string) => Promise<void>;
  /**
   * Persist a new auth blob on the active profile, then mirror into
   * localStorage. The profile is the single writer; localStorage is a
   * derived cache that drives `buildHeaders()` without further changes.
   */
  updateActiveProfileAuth: (auth: ProfileAuth) => Promise<void>;

  // Data
  tools: McpToolInfo[];
  resources: McpResourceInfo[];
  loading: boolean;
  loadingStatus: string | null;
  mcpError: string | null;

  // Auth
  authMethod: AuthMethod;
  token: string;
  tokenDraft: string;
  authOpen: boolean;
  oauth: OAuthState;
  oauthDebugEvents: OAuthDebugEvent[];
  oauthDebugOpen: boolean;

  // Cloud account (for tunnel publishing)
  cloudAuth: { email: string } | null;
  signInOpen: boolean;
  publishOpen: boolean;
  tunnel: {
    status: "idle" | "connecting" | "active" | "error";
    url: string | null;
    subdomain: string | null;
    error: string | null;
  };

  // Selection
  selected: SelectedItem | null;

  // Editor
  editorValue: string;

  // Studio UI
  studioTheme: "light" | "dark";
  /**
   * "test" while a recorded test is being replayed. UI components observe
   * this to render the blocking overlay, and store setters that schedule
   * `loadWidget` / `applyMock` skip those side effects in test mode so
   * replay-driven state changes don't trigger duplicate MCP calls.
   */
  studioMode: "normal" | "test";
  /**
   * Marker for an in-progress test slice. `startIndex` is the recorder
   * buffer position where "Record Test" was clicked. The Save modal opens
   * with `[startIndex, recorder.markIndex())` when the user clicks Stop.
   * Null when no slice is in progress.
   */
  slicingState: { startIndex: number; startedAt: string } | null;

  /**
   * Live replay state: drives the TopHeader's run-mode indicator and
   * step controls, and (when step mode is wired) serves as the source
   * of truth for whether to pause between actions. Null when no
   * replay is in flight.
   */
  runState: RunState | null;

  // Widget config
  platform: Platform;
  theme: string;
  locale: string;
  displayMode: string;
  viewportPreset: ViewportPreset;
  viewportCustom: ViewportSize;

  // Execution
  executing: boolean;
  jsonOutput: string | null;
  lastResult: unknown | null;
  /** Spec-compliance issues from the latest tool/resource response.
   *  Cleared on selection change and at the start of each execute. */
  resultIssues: ResultIssue[];
  actions: ActionEntry[];
  /** Forwarded `console.*` calls from the live widget iframe. Read-only
   *  debug info - never used for replay assertions. */
  consoleEntries: ConsoleEntry[];
  pendingMessages: PendingMessage[];

  // CSP / Strict mode
  strictMode: boolean;
  cspViolations: CspViolation[];

  // Raw widget HTML source (with tunnel URLs stripped to relative paths) -
  // matches what the static analyzer scanned, used by the HTML preview tab.
  widgetSourceHtml: string | null;

  // Raw widget HTML with tunnel URLs intact - fed to WidgetFrame, which
  // rewrites tunnels to the local proxy at render time so sandboxed iframe
  // asset requests resolve.
  widgetRawHtml: string | null;
  /** Pre-loaded widget HTML keyed by ui:// resource URI. Populated by
   *  `loadAll` after the resources list lands so a `tools/call` that
   *  surfaces a UI ref can render synchronously without a second
   *  `resources/read` round-trip — same shape as Claude / ChatGPT. */
  widgetCache: Record<string, string>;
  // Last mock used to render. WidgetFrame re-renders srcdoc when this
  // changes; applyMock hot-updates window.openai in place without changing
  // this field, so the iframe is not reloaded.
  currentMock: MockData | null;

  // Protocol detection
  detectedProtocols: { legacyOpenAI: boolean; extApps: boolean } | null;

  // Iframe refs (set by component)
  _iframeRef: HTMLIFrameElement | null;
  _extAppsMock: ReturnType<typeof createClaudeMock> | null;

  // Actions
  loadAll: () => Promise<void>;
  setAuthMethod: (method: AuthMethod) => void;
  setToken: (draft: string) => void;
  saveToken: () => Promise<void>;
  clearToken: () => Promise<void>;
  setAuthOpen: (open: boolean) => void;

  // OAuth actions
  startOAuthFlow: () => Promise<void>;
  handleOAuthCallback: (code: string, state: string) => Promise<void>;
  refreshOAuthToken: () => Promise<void>;
  signOut: () => void;
  setOAuthClientId: (id: string) => void;
  setOAuthClientSecret: (secret: string) => void;
  setOAuthRedirectUri: (uri: string) => void;
  setOAuthCustomHeaders: (headers: string) => void;
  /**
   * Validate the current custom-headers draft and persist it to the active
   * profile. Throws if the draft is not a JSON object of string values.
   */
  applyCustomHeaders: () => Promise<void>;
  setOAuthSelectedScopes: (scopes: string[]) => void;
  testOAuthEndpoints: () => Promise<void>;
  addOAuthDebugEvent: (event: OAuthDebugEvent) => void;
  clearOAuthDebugEvents: () => void;
  setOAuthDebugOpen: (open: boolean) => void;
  select: (item: SelectedItem) => void;
  setEditorValue: (value: string) => void;
  setStudioTheme: (t: "light" | "dark") => void;
  setStudioMode: (mode: "normal" | "test") => void;
  setSlicingState: (
    state: { startIndex: number; startedAt: string } | null,
  ) => void;
  setRunState: (next: RunState | null) => void;
  /** Partial update for in-flight runs. No-ops when runState is null. */
  patchRunState: (patch: Partial<RunState>) => void;
  setPlatform: (p: Platform) => void;
  setTheme: (t: string) => void;
  setLocale: (l: string) => void;
  setDisplayMode: (d: string) => void;
  setViewportPreset: (p: ViewportPreset) => void;
  setViewportCustom: (size: Partial<ViewportSize>) => void;
  getViewportSize: () => ViewportSize;
  logAction: (method: string, args: unknown) => void;
  clearActions: () => void;
  addConsoleEntry: (level: ConsoleLevel, args: string[]) => void;
  clearConsoleEntries: () => void;
  addPendingMessage: (source: "openai" | "claude", content: unknown) => void;
  dismissMessage: (id: string) => void;
  clearMessages: () => void;
  setIframeRef: (el: HTMLIFrameElement | null) => void;
  setStrictMode: (on: boolean) => void;
  addCspViolation: (v: CspViolation) => void;
  clearCspViolations: () => void;
  setProtocolDetected: (protocol: "legacy_openai" | "ext_apps") => void;

  // Cloud auth + tunnel actions
  hydrateCloudAuth: () => Promise<void>;
  hydrateTunnel: () => Promise<void>;
  setSignInOpen: (open: boolean) => void;
  setPublishOpen: (open: boolean) => void;
  cloudSignOut: () => Promise<void>;
  cloudAuthCompleted: (email: string) => void;
  startTunnel: (subdomain?: string) => Promise<void>;

  // Widget rendering
  resolveWidgetName: (responseMeta?: Record<string, unknown>) => string | null;
  renderWidget: (mock: MockData, overrideWidgetName?: string) => Promise<void>;
  /** Updates `currentMock` and triggers protocol detection. The HTML
   *  side-effects (`widgetSourceHtml`, `widgetRawHtml`) are set by
   *  `renderWidget` from the prefetched `widgetCache` (or an on-demand
   *  fallback fetch), not by this method. */
  applyWidgetMock: (widgetName: string, mock: WidgetMock) => Promise<void>;
  loadWidget: () => Promise<void>;
  applyMock: () => void;
  resetEditor: () => void;
  execute: () => Promise<void>;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  // Proxy connection
  proxyUrl: hasProxyUrl() ? getBaseUrl() : "",
  proxyConnected: hasProxyUrl(),

  setProxyUrl: (url: string) => {
    apiSetProxyUrl(url);
    // apiSetProxyUrl normalizes (auto-prepends http:// or https://). Read the
    // normalized value back so the store reflects what we actually use.
    set({ proxyUrl: getBaseUrl(), proxyConnected: true });
    resetSession();
    get().loadAll();
  },

  // Profiles
  profiles: [] as Profile[],
  activeProfileId: null as string | null,

  refreshProfiles: async () => {
    try {
      const resp = await listProfiles();
      set({ profiles: resp.profiles, activeProfileId: resp.active_id });

      // First-run hydration: if URL is unset and the active profile has one,
      // adopt it so Studio connects without an extra click. Skip when the
      // user already opened with `?proxy=` so we never override an explicit URL.
      const { proxyUrl } = get();
      if (!proxyUrl && resp.active_id) {
        const active = resp.profiles.find((p) => p.id === resp.active_id);
        if (active && active.server_url) {
          get().setProxyUrl(active.server_url);
        }
      }

      // One-shot migration: existing installs have origin-scoped auth in
      // localStorage but profiles with `auth: undefined`. Walk every profile
      // once, setProxyUrl to its origin, snapshot whatever auth is configured
      // for that origin, and persist it onto the profile. Gated by a global
      // flag so creating a new empty profile later does not auto-seed from
      // stale localStorage.
      if (!localStorage.getItem(PROFILE_AUTH_MIGRATION_FLAG)) {
        const originalUrl = get().proxyUrl;
        for (const p of resp.profiles) {
          if (p.auth || !p.server_url) continue;
          // setProxyUrl is what makes studioKey() resolve to this origin.
          apiSetProxyUrl(p.server_url);
          const snapshot = snapshotOriginAuthForMigration();
          if (snapshot) {
            try {
              await apiUpdateProfile(p.id, { auth: snapshot });
            } catch {
              /* migration is best-effort; user can re-enter auth manually */
            }
          }
        }
        // Restore the originally active URL so we don't leave the store
        // pointing at the last profile we visited during migration.
        if (originalUrl) {
          apiSetProxyUrl(originalUrl);
        }
        localStorage.setItem(PROFILE_AUTH_MIGRATION_FLAG, "1");
        // Re-list so the store reflects the seeded auth.
        const after = await listProfiles();
        set({ profiles: after.profiles, activeProfileId: after.active_id });
      }

      // Apply active profile's auth into the localStorage cache so
      // `buildHeaders()` sees the right token from the first request on.
      // Also resync the store's auth slice; without this the auth panel
      // renders the empty snapshot taken at store-init time (before any
      // profile URL was known) and the green "OAuth"/"Bearer" badge never
      // lights up even when a token is present.
      const finalActive = get().profiles.find(
        (p) => p.id === get().activeProfileId,
      );
      if (finalActive) {
        applyProfileAuthToLocalStorage(finalActive.auth);
        set((s) => ({
          authMethod: readAuthMethod(),
          token: getBearerToken(),
          tokenDraft: getBearerToken(),
          oauth: snapshotOauthSliceFromOrigin(s.oauth),
        }));
      }
    } catch {
      /* backend not ready yet — caller can retry */
    }
  },

  activateAndApply: async (id: string) => {
    const resp = await apiActivateProfile(id);
    set({ profiles: resp.profiles, activeProfileId: resp.active_id });
    const active = resp.profiles.find((p) => p.id === resp.active_id);
    if (!active) return;
    // Order matters: setProxyUrl first so studioKey() in
    // applyProfileAuthToLocalStorage resolves to the new origin.
    if (active.server_url) {
      get().setProxyUrl(active.server_url);
    }
    applyProfileAuthToLocalStorage(active.auth);
    // Reflect the new auth in the studio store so the auth panel updates.
    set((s) => ({
      authMethod: readAuthMethod(),
      token: getBearerToken(),
      tokenDraft: getBearerToken(),
      oauth: snapshotOauthSliceFromOrigin(s.oauth),
    }));
    resetSession();
  },

  updateActiveProfileAuth: async (auth: ProfileAuth) => {
    const id = get().activeProfileId;
    if (!id) throw new Error("No active profile");
    // Profile is the single writer; mirror to localStorage only on success
    // so a failed PUT cannot leave disk and cache disagreeing.
    const updated = await apiUpdateProfile(id, { auth });
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === id ? updated : p)),
    }));
    applyProfileAuthToLocalStorage(auth);
    set((s) => ({
      authMethod: readAuthMethod(),
      token: getBearerToken(),
      tokenDraft: getBearerToken(),
      oauth: snapshotOauthSliceFromOrigin(s.oauth),
    }));
    resetSession();
  },

  // Data
  tools: [],
  resources: [],
  loading: true,
  loadingStatus: null,
  mcpError: null,

  // Auth (all scoped per proxy URL via api.ts)
  authMethod: readAuthMethod(),
  token: getBearerToken(),
  tokenDraft: getBearerToken(),
  // Default closed — sidebar real estate stays for tools/resources. The
  // auth panel still auto-opens on connection errors / missing tokens
  // (see `loadAll`, `saveToken`, `clearToken`).
  authOpen: false,
  oauth: (() => {
    const saved = loadOAuthTokens();
    const hasToken = !!saved.accessToken;
    return {
      status: hasToken ? ("connected" as const) : ("idle" as const),
      metadata: null,
      complianceChecks: [],
      clientId: saved.clientId || "",
      clientSecret: "",
      redirectUri: "",
      customHeaders: JSON.stringify(readCustomHeaders()) || "",
      accessToken: saved.accessToken,
      refreshToken: saved.refreshToken,
      expiresAt: saved.expiresAt,
      scopes: saved.scope ? saved.scope.split(" ") : [],
      selectedScopes: [],
      error: null,
      decodedToken: hasToken ? decodeToken(saved.accessToken!) : null,
    };
  })(),
  oauthDebugEvents: [],
  oauthDebugOpen: false,

  // Cloud account
  cloudAuth: null,
  signInOpen: false,
  publishOpen: false,
  tunnel: { status: "idle", url: null, subdomain: null, error: null },

  // Selection
  selected: null,

  // Editor
  editorValue: defaultEditorValue(),

  // Studio UI
  studioTheme: (() => {
    document.documentElement.classList.add("dark");
    return "dark" as "light" | "dark";
  })(),
  studioMode: "normal" as "normal" | "test",
  slicingState: null as { startIndex: number; startedAt: string } | null,
  runState: null as RunState | null,

  // Widget config
  platform: "openai",
  theme: "dark",
  locale: "en-US",
  displayMode: "compact",
  viewportPreset: "mobile" as ViewportPreset,
  viewportCustom: { width: 430, height: 932 },

  // Execution
  executing: false,
  jsonOutput: null,
  lastResult: null,
  resultIssues: [],
  actions: [],
  consoleEntries: [],
  pendingMessages: [],

  // CSP / Strict mode
  strictMode: false,
  cspViolations: [],
  widgetSourceHtml: null,
  widgetRawHtml: null,
  widgetCache: {},
  currentMock: null,

  // Protocol detection
  detectedProtocols: null,

  // Refs
  _iframeRef: null,
  _extAppsMock: null,

  // ── Actions ──

  loadAll: async () => {
    set({
      loading: true,
      loadingStatus: "Initializing session…",
      mcpError: null,
    });

    // Step 1: Initialize MCP session. `mcpInitialize` resets internally —
    // a second `resetSession()` here would clobber the in-flight handshake
    // it just kicked off and race with any health-probe caller.
    try {
      await mcpInitialize();
    } catch (e) {
      const msg = (e as Error).message || "Session initialization failed";
      set({
        loading: false,
        loadingStatus: null,
        mcpError: `Session: ${msg}`,
        authOpen: true,
      });
      return;
    }

    // Step 2: Fetch tools and resources in parallel
    set({ loadingStatus: "Fetching tools & resources…" });
    const [toolsResult, resourcesResult] = await Promise.allSettled([
      listTools(),
      listResources(),
    ]);

    const t = toolsResult.status === "fulfilled" ? toolsResult.value : [];
    const r =
      resourcesResult.status === "fulfilled" ? resourcesResult.value : [];

    // Collect errors from MCP fetches
    const errors: string[] = [];
    if (toolsResult.status === "rejected")
      errors.push(`Tools: ${toolsResult.reason?.message || "failed"}`);
    if (resourcesResult.status === "rejected")
      errors.push(`Resources: ${resourcesResult.reason?.message || "failed"}`);
    const mcpError = errors.length > 0 ? errors.join("\n") : null;

    if (mcpError) set({ authOpen: true });

    set({
      tools: t.sort((a, b) => a.name.localeCompare(b.name)),
      resources: r.sort((a, b) =>
        (a.name || a.uri).localeCompare(b.name || b.uri),
      ),
      loading: false,
      loadingStatus: null,
      mcpError,
      // New resource list ⇒ stale cache must go before prefetch below
      // (and before any tool-call render can hit it).
      widgetCache: {},
    });

    // Step 3: Pre-load every ui:// widget HTML in parallel. Mirrors how
    // Claude / ChatGPT hydrate apps up-front so a subsequent tools/call
    // renders synchronously from cache instead of paying a second
    // resources/read round-trip per render.
    const widgetUris = r
      .filter(
        (res) =>
          res.uri.startsWith("ui://") &&
          res.mimeType === "text/html;profile=mcp-app",
      )
      .map((res) => res.uri);
    if (widgetUris.length > 0) {
      const settled = await Promise.allSettled(
        widgetUris.map((uri) => readResource(uri)),
      );
      const cache: Record<string, string> = {};
      for (let i = 0; i < widgetUris.length; i++) {
        const res = settled[i];
        if (res.status !== "fulfilled") continue;
        const result = res.value as { contents?: { text?: string }[] };
        const html = result?.contents?.[0]?.text ?? "";
        if (html) cache[widgetUris[i]] = html;
      }
      set({ widgetCache: cache });
    }

    // Auto-select first item
    const { selected } = get();
    if (!selected) {
      if (t.length > 0) get().select({ type: "tool", tool: t[0] });
      else if (r.length > 0) get().select({ type: "resource", resource: r[0] });
    }
  },

  setAuthMethod: (method) => {
    // UI-only: switches the visible tab in the auth panel. Persistence to
    // the active profile (and localStorage cache) happens at the explicit
    // commit moments below: saveToken / clearToken / applyCustomHeaders /
    // OAuth callback success.
    set({ authMethod: method });
  },

  setToken: (draft) => set({ tokenDraft: draft }),

  saveToken: async () => {
    const { tokenDraft } = get();
    await get().updateActiveProfileAuth({
      method: "bearer",
      token: tokenDraft,
    });
    set({ token: tokenDraft, authOpen: !tokenDraft });
    get().loadAll();
  },

  clearToken: async () => {
    await get().updateActiveProfileAuth({ method: "bearer", token: "" });
    set({ token: "", tokenDraft: "", authOpen: true });
    get().loadAll();
  },

  setAuthOpen: (open) => set({ authOpen: open }),

  // ── OAuth Actions ──

  addOAuthDebugEvent: (event) => {
    set((s) => {
      // Replace pending event with same id, or append new
      const existing = s.oauthDebugEvents.findIndex((e) => e.id === event.id);
      if (existing >= 0) {
        const updated = [...s.oauthDebugEvents];
        updated[existing] = event;
        return { oauthDebugEvents: updated };
      }
      return { oauthDebugEvents: [...s.oauthDebugEvents, event] };
    });
  },

  clearOAuthDebugEvents: () => set({ oauthDebugEvents: [] }),

  setOAuthDebugOpen: (open) => set({ oauthDebugOpen: open }),

  setOAuthClientId: (id) => {
    set((s) => ({ oauth: { ...s.oauth, clientId: id } }));
  },

  setOAuthClientSecret: (secret) => {
    set((s) => ({ oauth: { ...s.oauth, clientSecret: secret } }));
  },

  setOAuthCustomHeaders: (headers) => {
    // Draft only. `applyCustomHeaders` commits to the active profile.
    set((s) => ({ oauth: { ...s.oauth, customHeaders: headers } }));
  },

  applyCustomHeaders: async () => {
    const raw = get().oauth.customHeaders.trim();
    if (!raw) return;
    let parsed: Record<string, string>;
    try {
      const value = JSON.parse(raw);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("custom headers must be a JSON object");
      }
      parsed = {};
      for (const [k, v] of Object.entries(value)) {
        if (typeof v !== "string") continue;
        parsed[k] = v;
      }
    } catch (e) {
      throw new Error((e as Error).message);
    }
    await get().updateActiveProfileAuth({ method: "custom", headers: parsed });
    get().loadAll();
  },

  setOAuthRedirectUri: (uri) => {
    set((s) => ({ oauth: { ...s.oauth, redirectUri: uri } }));
  },

  setOAuthSelectedScopes: (scopes) => {
    set((s) => ({ oauth: { ...s.oauth, selectedScopes: scopes } }));
  },

  startOAuthFlow: async () => {
    const baseUrl = getBaseUrl();
    const onEvent = get().addOAuthDebugEvent;
    const effectiveRedirectUri = get().oauth.redirectUri || getRedirectUri();

    // Step 1: Metadata Discovery
    set((s) => ({
      oauth: { ...s.oauth, status: "discovering", error: null },
    }));

    const metadata = await discoverMetadata(baseUrl, onEvent);
    const endpoints = resolveEndpoints(baseUrl, metadata);
    const complianceChecks = metadata ? checkCompliance(metadata) : [];
    const scopes = metadata?.scopes_supported || [];

    set((s) => ({
      oauth: {
        ...s.oauth,
        metadata,
        complianceChecks,
        scopes,
        selectedScopes:
          s.oauth.selectedScopes.length > 0 ? s.oauth.selectedScopes : scopes,
      },
    }));

    // Step 2: Dynamic Client Registration (if no client_id set)
    let clientId = get().oauth.clientId;
    if (!clientId) {
      set((s) => ({ oauth: { ...s.oauth, status: "registering" } }));

      if (endpoints.registrationEndpoint) {
        const registration = await registerClient(
          endpoints.registrationEndpoint,
          effectiveRedirectUri,
          onEvent,
        );
        if (registration) {
          clientId = registration.clientId;
          set((s) => ({ oauth: { ...s.oauth, clientId } }));
        }
      }

      if (!clientId) {
        set((s) => ({
          oauth: {
            ...s.oauth,
            status: "error",
            error:
              "Dynamic client registration failed. Enter a client_id manually.",
          },
        }));
        return;
      }
    }

    // Step 3: Generate PKCE and redirect to authorization
    set((s) => ({ oauth: { ...s.oauth, status: "authorizing" } }));

    const { codeVerifier, codeChallenge } = await generatePKCE();
    const state = generateRandomString(32);
    writePKCE(codeVerifier, state);

    const authUrl = buildAuthorizationUrl({
      authorizationEndpoint: endpoints.authorizationEndpoint,
      clientId,
      redirectUri: effectiveRedirectUri,
      codeChallenge,
      state,
      scopes: get().oauth.selectedScopes,
    });

    // Save flow state so the callback page can complete the token exchange
    // after the full-page redirect (Zustand store won't survive the redirect).
    saveOAuthFlowState({
      tokenEndpoint: endpoints.tokenEndpoint,
      clientId,
      redirectUri: effectiveRedirectUri,
      proxyUrl: baseUrl,
      codeVerifier,
      state,
    });

    // Open auth in a new tab so Studio stays open. If the redirect_uri
    // points to the cloud callback (same origin), the new tab handles the
    // token exchange and redirects back. If it points to the proxy relay,
    // the relay forwards to the cloud callback to complete the flow.
    const opened = window.open(authUrl, "_blank");
    if (!opened) {
      // Popup blocked — fall back to same-page redirect
      window.location.href = authUrl;
    }
  },

  handleOAuthCallback: async (code, state) => {
    const baseUrl = getBaseUrl();
    const onEvent = get().addOAuthDebugEvent;
    const effectiveRedirectUri = get().oauth.redirectUri || getRedirectUri();

    // Validate state
    const pkce = readPKCE();
    if (!pkce.state || pkce.state !== state) {
      set((s) => ({
        oauth: {
          ...s.oauth,
          status: "error",
          error: "OAuth state mismatch — possible CSRF attack. Try again.",
        },
      }));
      return;
    }

    if (!pkce.codeVerifier) {
      set((s) => ({
        oauth: {
          ...s.oauth,
          status: "error",
          error: "Missing PKCE code_verifier. Try signing in again.",
        },
      }));
      return;
    }

    set((s) => ({ oauth: { ...s.oauth, status: "exchanging" } }));

    const metadata = get().oauth.metadata;
    const endpoints = resolveEndpoints(baseUrl, metadata);
    const clientId = get().oauth.clientId;

    try {
      const tokens = await exchangeCode(
        endpoints.tokenEndpoint,
        code,
        effectiveRedirectUri,
        clientId,
        pkce.codeVerifier,
        onEvent,
      );

      saveOAuthTokens(tokens, clientId);
      removePKCE();

      // Mark the active profile as `oauth` so future activations know to
      // resolve the token from origin localStorage rather than treat the
      // profile as unauthed. Best-effort: the OAuth flow itself succeeded
      // even if the profile write fails.
      try {
        await get().updateActiveProfileAuth({ method: "oauth" });
      } catch {
        /* ignore */
      }

      const decoded = decodeToken(tokens.access_token);

      set((s) => ({
        oauth: {
          ...s.oauth,
          status: "connected",
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt: tokens.expires_in
            ? Date.now() + tokens.expires_in * 1000
            : null,
          error: null,
          decodedToken: decoded,
        },
      }));

      // Reload MCP data with new token
      get().loadAll();
    } catch (e) {
      set((s) => ({
        oauth: {
          ...s.oauth,
          status: "error",
          error: (e as Error).message,
        },
      }));
    }
  },

  refreshOAuthToken: async () => {
    const baseUrl = getBaseUrl();
    const onEvent = get().addOAuthDebugEvent;
    const { refreshToken, clientId } = get().oauth;

    if (!refreshToken || !clientId) return;

    const metadata = get().oauth.metadata;
    const endpoints = resolveEndpoints(baseUrl, metadata);

    try {
      const tokens = await oauthRefresh(
        endpoints.tokenEndpoint,
        refreshToken,
        clientId,
        onEvent,
      );

      saveOAuthTokens(tokens, clientId);

      const decoded = decodeToken(tokens.access_token);

      set((s) => ({
        oauth: {
          ...s.oauth,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || s.oauth.refreshToken,
          expiresAt: tokens.expires_in
            ? Date.now() + tokens.expires_in * 1000
            : null,
          decodedToken: decoded,
        },
      }));
    } catch (e) {
      set((s) => ({
        oauth: {
          ...s.oauth,
          status: "error",
          error: (e as Error).message,
        },
      }));
    }
  },

  signOut: () => {
    clearOAuthTokens();
    removePKCE();
    resetSession();
    set((s) => ({
      oauth: {
        ...s.oauth,
        status: "idle",
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        error: null,
        decodedToken: null,
      },
    }));
    get().loadAll();
  },

  testOAuthEndpoints: async () => {
    const baseUrl = getBaseUrl();
    const onEvent = get().addOAuthDebugEvent;
    const metadata = get().oauth.metadata;
    const endpoints = resolveEndpoints(baseUrl, metadata);

    await testEndpoint(
      `${getAuthBaseUrl(baseUrl)}/.well-known/oauth-authorization-server`,
      "GET",
      onEvent,
    );
    await testEndpoint(endpoints.authorizationEndpoint, "GET", onEvent);
    await testEndpoint(endpoints.tokenEndpoint, "POST", onEvent);
    if (endpoints.registrationEndpoint) {
      await testEndpoint(endpoints.registrationEndpoint, "POST", onEvent);
    }
  },

  select: (item) => {
    // Destroy previous claude mock
    get()._extAppsMock?.destroy();
    set({
      selected: item,
      actions: [],
      consoleEntries: [],
      pendingMessages: [],
      jsonOutput: null,
      lastResult: null,
      resultIssues: [],
      _extAppsMock: null,
      widgetRawHtml: null,
      currentMock: null,
    });

    // Set editor value based on selection type
    if (item.type === "tool") {
      set({ editorValue: toolArgsFromSchema(item.tool.inputSchema) });
    } else if (item.type === "resource") {
      set({ editorValue: JSON.stringify({ uri: item.resource.uri }, null, 2) });
    }

    // Auto-load widget if applicable (defer to let React update refs).
    // Skipped during replay (studioMode === "test") so a deferred
    // loadWidget here doesn't fire an extra `resources/read` on top of
    // the one the replay runner is already executing.
    const widgetName = get().resolveWidgetName();
    if (widgetName && get().studioMode !== "test") {
      // Small delay to ensure iframe ref is set
      setTimeout(() => get().loadWidget(), 50);
    }
  },

  setEditorValue: (value) => set({ editorValue: value }),
  setStudioTheme: (t) => {
    set({ studioTheme: t });
    document.documentElement.classList.toggle("dark", t === "dark");
  },
  setStudioMode: (mode) => set({ studioMode: mode }),
  setSlicingState: (state) => set({ slicingState: state }),
  setRunState: (next) => set({ runState: next }),
  patchRunState: (patch) =>
    set((s) => ({ runState: s.runState ? { ...s.runState, ...patch } : null })),
  setPlatform: (p) => {
    set({ platform: p });
    if (get().studioMode !== "test") {
      setTimeout(() => get().loadWidget(), 50);
    }
  },
  setTheme: (t) => {
    set({ theme: t });
    if (get().studioMode !== "test") {
      setTimeout(() => get().applyMock(), 50);
    }
  },
  setLocale: (l) => {
    set({ locale: l });
    if (get().studioMode !== "test") {
      setTimeout(() => get().applyMock(), 50);
    }
  },
  setDisplayMode: (d) => {
    set({ displayMode: d });
    if (get().studioMode !== "test") {
      setTimeout(() => get().applyMock(), 50);
    }
  },
  setViewportPreset: (p) => set({ viewportPreset: p }),
  setViewportCustom: (size) => {
    set((s) => ({
      viewportCustom: { ...s.viewportCustom, ...size },
    }));
  },
  getViewportSize: () => {
    const { viewportPreset, viewportCustom } = get();
    if (viewportPreset === "custom") return viewportCustom;
    return VIEWPORT_PRESETS[viewportPreset];
  },

  logAction: (method, args) => {
    const argsStr = typeof args === "string" ? args : JSON.stringify(args);
    set((s) => ({
      actions: [
        ...s.actions,
        { time: formatTimestamp(), method, args: argsStr },
      ],
    }));
  },

  clearActions: () => set({ actions: [] }),

  addConsoleEntry: (level, args) =>
    set((s) => ({
      consoleEntries: [
        ...s.consoleEntries,
        { time: formatTimestamp(), level, args },
      ],
    })),

  clearConsoleEntries: () => set({ consoleEntries: [] }),

  addPendingMessage: (source, content) => {
    const msg: PendingMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: formatTimestamp(),
      source,
      content,
    };
    set((s) => ({ pendingMessages: [...s.pendingMessages, msg] }));
  },

  dismissMessage: (id) => {
    set((s) => ({
      pendingMessages: s.pendingMessages.filter((m) => m.id !== id),
    }));
  },

  clearMessages: () => set({ pendingMessages: [] }),

  setIframeRef: (el) => set({ _iframeRef: el }),

  setStrictMode: (on) => {
    set({ strictMode: on, cspViolations: [] });
    if (get().studioMode !== "test") {
      setTimeout(() => get().loadWidget(), 50);
    }
  },

  addCspViolation: (v) => {
    set((s) => {
      // Deduplicate by directive + blockedUri
      const isDupe = s.cspViolations.some(
        (existing) =>
          existing.directive === v.directive &&
          existing.blockedUri === v.blockedUri,
      );
      if (isDupe) return s;
      return { cspViolations: [...s.cspViolations, v] };
    });
  },

  clearCspViolations: () => set({ cspViolations: [] }),

  setProtocolDetected: (protocol) =>
    set((s) => {
      const prev = s.detectedProtocols ?? {
        legacyOpenAI: false,
        extApps: false,
      };
      return {
        detectedProtocols:
          protocol === "legacy_openai"
            ? { ...prev, legacyOpenAI: true }
            : { ...prev, extApps: true },
      };
    }),

  // ── Cloud auth + tunnel ──

  hydrateCloudAuth: async () => {
    try {
      const status = await fetchAuthStatus();
      set({ cloudAuth: status.email ? { email: status.email } : null });
    } catch {
      set({ cloudAuth: null });
    }
  },

  hydrateTunnel: async () => {
    try {
      const s = await fetchTunnelStatus();
      if (s.active && s.info) {
        set({
          tunnel: {
            status: "active",
            url: s.info.url,
            subdomain: s.info.subdomain,
            error: null,
          },
        });
      }
    } catch {
      // ignore
    }
  },

  setSignInOpen: (open: boolean) => set({ signInOpen: open }),
  setPublishOpen: (open: boolean) => set({ publishOpen: open }),

  cloudAuthCompleted: (email: string) =>
    set({ cloudAuth: { email }, signInOpen: false, publishOpen: true }),

  cloudSignOut: async () => {
    await authLogout();
    set({ cloudAuth: null });
  },

  startTunnel: async (subdomain?: string) => {
    const mcpUrl = get().proxyUrl;
    if (!mcpUrl) {
      set((s) => ({
        tunnel: {
          ...s.tunnel,
          status: "error",
          error: "Set an MCP server URL first",
        },
      }));
      return;
    }
    set({
      tunnel: { status: "connecting", url: null, subdomain: null, error: null },
      publishOpen: false,
    });
    try {
      const info = await apiStartTunnel(mcpUrl, subdomain);
      set({
        tunnel: {
          status: "active",
          url: info.url,
          subdomain: info.subdomain,
          error: null,
        },
      });
    } catch (e) {
      set((s) => ({
        tunnel: { ...s.tunnel, status: "error", error: (e as Error).message },
      }));
    }
  },

  // ── Widget name resolution ──

  resolveWidgetName: (responseMeta) => {
    // 1. Check response meta (from tools/call result)
    if (responseMeta) {
      const fromResponse = extractWidgetUri(responseMeta);
      if (fromResponse) return fromResponse;
    }

    const { selected } = get();
    if (!selected) return null;

    // 2. Resource → parse URI (ui://widget/{name} or ui://{app}/{path})
    if (selected.type === "resource") {
      // Reuse extractWidgetUri logic by wrapping in a fake meta object
      const fromUri = extractWidgetUri({
        ui: { resourceUri: selected.resource.uri },
      });
      if (fromUri) return fromUri;
    }

    // 4. Tool → check meta, then fuzzy match against ui:// resources
    if (selected.type === "tool") {
      const meta = selected.tool.meta;
      if (meta) {
        const fromMeta = extractWidgetUri(meta);
        if (fromMeta) return fromMeta;
      }

      // Fuzzy match against ui:// resource names
      const { resources } = get();
      const uiResources = resources.filter((r) => r.uri.startsWith("ui://"));
      const toolName = selected.tool.name;

      for (const r of uiResources) {
        const fromUri = extractWidgetUri({ ui: { resourceUri: r.uri } });
        if (!fromUri) continue;
        if (fromUri === toolName) return fromUri;
        if (toolName.includes(fromUri) || fromUri.includes(toolName))
          return fromUri;
        const stripped = toolName.replace(
          /^(create|get|list|update|add|delete|remove|submit|review)_/,
          "",
        );
        if (
          fromUri === stripped ||
          fromUri.includes(stripped) ||
          stripped.includes(fromUri)
        )
          return fromUri;
      }
    }

    return null;
  },

  // ── Widget rendering ──

  renderWidget: async (mock, overrideWidgetName) => {
    const { addCspViolation } = get();
    const name = overrideWidgetName || get().resolveWidgetName();
    if (!name) return;

    // Reset prior view state. The iframe element itself is owned by
    // `<WidgetFrame>`; this routine clears the slot then loads HTML
    // and applies the mock. extAppsMock is wired in WidgetPreview as
    // an effect on (iframe ref, currentMock).
    get()._extAppsMock?.destroy();
    set({
      _extAppsMock: null,
      cspViolations: [],
      detectedProtocols: null,
      widgetSourceHtml: null,
      widgetRawHtml: null,
      currentMock: null,
    });

    const { resources, widgetCache } = get();
    const resUri = resources.find(
      (r) =>
        r.uri.startsWith("ui://") &&
        r.uri.includes(name) &&
        r.mimeType === "text/html;profile=mcp-app",
    )?.uri;
    if (!resUri) return;

    // Prefer the prefetched cache (loadAll fills this for every ui://
    // widget). On miss — e.g. a server that surfaced a UI ref after
    // loadAll, or a manually-warmed flow — fetch on demand and warm the
    // cache so the next render is also synchronous.
    let rawHtml = widgetCache[resUri] ?? "";
    if (!rawHtml) {
      const result = (await readResource(resUri)) as {
        contents?: { text?: string }[];
      };
      rawHtml = result?.contents?.[0]?.text ?? "";
      if (rawHtml) {
        set((s) => ({
          widgetCache: { ...s.widgetCache, [resUri]: rawHtml },
        }));
      }
    }
    if (!rawHtml) return;
    set({
      widgetSourceHtml: stripTunnelUrls(rawHtml),
      widgetRawHtml: rawHtml,
    });

    // CSP analysis uses the tool-call meta (not the widget HTML response
    // meta), so we still run it here where we have the mock context.
    const cspDomains = extractCspDomains(
      (mock._meta || {}) as Record<string, unknown>,
    );
    const { findings } = analyze(get().widgetSourceHtml ?? rawHtml, cspDomains);
    for (const finding of findings) {
      addCspViolation(toStaticViolation(finding, { sourceFile: resUri }));
    }

    // Apply the mock; the iframe re-renders against `currentMock`.
    await get().applyWidgetMock(name, {
      toolInput: mock.toolInput,
      toolOutput: mock.toolOutput,
      meta: (mock._meta || {}) as Record<string, unknown>,
      widgetState: mock.widgetState ?? null,
    });
  },

  applyWidgetMock: async (widgetName, mock) => {
    const fullMock: MockData = {
      toolInput: mock.toolInput,
      toolOutput: mock.toolOutput,
      _meta: mock.meta,
      widgetState: mock.widgetState ?? null,
      theme: get().theme,
      locale: get().locale,
      displayMode: get().displayMode,
    };
    get()._extAppsMock?.destroy();
    set({
      _extAppsMock: null,
      currentMock: fullMock,
    });
    // Re-detect protocol from the cached HTML (the bus subscriber set
    // widgetRawHtml when the resources/read response arrived).
    const html = get().widgetRawHtml ?? "";
    if (/window\.openai\b/.test(html)) {
      get().setProtocolDetected("legacy_openai");
    }
    get().setProtocolDetected("ext_apps");
  },

  loadWidget: async () => {
    const { editorValue, theme, locale, displayMode, logAction, renderWidget } =
      get();
    try {
      const parsed = JSON.parse(editorValue);
      const mock: MockData = {
        toolInput: parsed.toolInput || {},
        toolOutput: parsed.toolOutput || {},
        _meta: parsed._meta || {},
        widgetState: parsed.widgetState || null,
        theme,
        locale,
        displayMode,
      };
      await renderWidget(mock);
    } catch (e) {
      logAction("error", `Invalid JSON: ${(e as Error).message}`);
    }
  },

  applyMock: () => {
    const {
      _iframeRef: iframe,
      platform,
      editorValue,
      theme,
      locale,
      displayMode,
      logAction,
      renderWidget,
      resolveWidgetName,
    } = get();
    if (!resolveWidgetName()) return;

    try {
      const parsed = JSON.parse(editorValue);
      const mock: MockData = {
        toolInput: parsed.toolInput || {},
        toolOutput: parsed.toolOutput || {},
        _meta: parsed._meta || {},
        widgetState: parsed.widgetState || null,
        theme,
        locale,
        displayMode,
      };

      // Try hot-update first
      if (platform === "openai" && iframe) {
        try {
          const win = iframe.contentWindow;
          if (win && (win as unknown as { openai: unknown }).openai) {
            const openai = (
              win as unknown as { openai: Record<string, unknown> }
            ).openai;
            openai.toolInput = mock.toolInput;
            openai.toolOutput = mock.toolOutput;
            openai.toolResponseMetadata = mock._meta;
            openai.widgetState = mock.widgetState;
            openai.theme = mock.theme;
            openai.locale = mock.locale;
            openai.displayMode = mock.displayMode;
            win.dispatchEvent(new CustomEvent("openai:set_globals"));
            // Also update ext-apps mock (OpenAI now supports both)
            get()._extAppsMock?.update(mock);
            logAction("system", "Mock data applied");
            return;
          }
        } catch {
          /* fall through to full reload */
        }
      }

      if (platform === "claude") {
        get()._extAppsMock?.update(mock);
        logAction("system", "Mock data applied");
        return;
      }

      // Full reload fallback
      renderWidget(mock);
      logAction("system", "Mock data applied (reload)");
    } catch (e) {
      logAction("error", `Invalid JSON: ${(e as Error).message}`);
    }
  },

  resetEditor: () => {
    const { selected, loadWidget } = get();
    if (!selected) return;
    if (selected.type === "tool") {
      set({ editorValue: toolArgsFromSchema(selected.tool.inputSchema) });
    } else if (selected.type === "resource") {
      set({
        editorValue: JSON.stringify({ uri: selected.resource.uri }, null, 2),
      });
    }
    if (get().studioMode !== "test") {
      setTimeout(loadWidget, 50);
    }
  },

  // ── Execute ──

  execute: async () => {
    const {
      selected,
      editorValue,
      theme,
      locale,
      displayMode,
      logAction,
      renderWidget,
      resolveWidgetName,
    } = get();
    if (!selected) return;
    set({ executing: true, resultIssues: [] });
    logAction("system", `Executing ${selected.type}…`);

    try {
      let result: unknown;

      if (selected.type === "tool") {
        const args = JSON.parse(editorValue);
        const action = new ToolCallAction(selected.tool.name, args);
        await action.execute();
        recorder.record(action, { stateChange: action.change() });
        if (action.result?.error) throw new Error(action.result.error.message);
        result = action.result?.data;
        logAction("tools/call", { name: selected.tool.name, result });
      } else if (selected.type === "resource") {
        const action = new ResourceReadAction(selected.resource.uri);
        await action.execute();
        recorder.record(action, { stateChange: action.change() });
        if (action.result?.error) throw new Error(action.result.error.message);
        result = action.result?.data;
        logAction("resources/read", { uri: selected.resource.uri, result });
      } else {
        set({ executing: false });
        return;
      }

      // Spec-compliance check. The biggest footgun is structuredContent
      // shape: hosts (Claude / ChatGPT) consume it as an object, so a
      // primitive or array silently breaks downstream parsing. Surface
      // any issues to both the action log and the preview banner.
      if (selected.type === "tool") {
        const issues = validateToolResult(result);
        if (issues.length > 0) {
          set({ resultIssues: issues });
          for (const issue of issues) {
            logAction(
              issue.severity === "error" ? "error" : "warn",
              `${issue.title} - ${issue.detail}`,
            );
          }
        }
      }

      // Extract tool output
      const content = result as {
        content?: Array<{ type: string; text?: string }>;
        _meta?: Record<string, unknown>;
        meta?: Record<string, unknown>;
      };
      let toolOutput: unknown = result;
      const meta = content._meta || content.meta || {};

      if (content.content) {
        const textContent = content.content.find((c) => c.type === "text");
        if (textContent?.text) {
          try {
            toolOutput = JSON.parse(textContent.text);
          } catch {
            toolOutput = textContent.text;
          }
        }
      }

      const toolInput = selected.type === "tool" ? JSON.parse(editorValue) : {};
      const mockData = {
        toolInput,
        toolOutput,
        _meta: meta,
        widgetState: null,
      };

      // Store result separately — don't overwrite editor
      set({ lastResult: result });

      // Resolve widget from response meta
      const widgetName = resolveWidgetName(meta);

      if (widgetName) {
        set({ jsonOutput: null });
        const mock: MockData = { ...mockData, theme, locale, displayMode };
        await renderWidget(mock, widgetName);
        logAction(
          "system",
          `Widget "${widgetName}" rendered with real tool response`,
        );
      } else {
        set({ jsonOutput: JSON.stringify(result, null, 2) });
        logAction("system", "No widget — showing JSON response");
      }
    } catch (e) {
      logAction("error", (e as Error).message);
    } finally {
      set({ executing: false });
    }
  },
}));

// Always-on recorder: start a session as soon as the store module loads.
// Browser-only — guard for SSR / unit tests. Widget HTML is no longer
// derived from the response bus; `loadAll` prefetches every ui:// resource
// into `widgetCache`, and `renderWidget` reads from there.
if (typeof window !== "undefined") {
  const s = useStudioStore.getState();
  recorder.start({
    url: s.proxyUrl,
    theme: s.theme,
    locale: s.locale,
  });
}
