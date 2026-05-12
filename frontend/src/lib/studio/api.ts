/**
 * Studio API - communicates exclusively with the MCP proxy.
 *
 * All state (auth tokens, session, custom headers) is scoped per proxy URL
 * and stored under the "studio:" localStorage prefix to avoid collision
 * with mcpr-cloud's own auth (cookie-based JWT).
 */

import { recordedMcpCall } from "../recorder/mcp-interceptor";
import type { Source } from "../recorder/schema";
import { reportHealth } from "./health";

// ── Proxy URL ──

/** Mutable proxy URL set at runtime via setProxyUrl(). */
let _overrideProxyUrl: string | null = null;

/**
 * Auto-prepend protocol when not provided:
 * - localhost / 127.0.0.1 / 0.0.0.0 / ::1 → http://
 * - everything else → https://
 * Also strips trailing slashes.
 */
function normalizeProxyUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, "");
  if (!cleaned) return cleaned;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  const host = cleaned.split("/")[0].split(":")[0].toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1";
  return `${isLocal ? "http" : "https"}://${cleaned}`;
}

export function getBaseUrl(): string {
  if (_overrideProxyUrl) {
    return _overrideProxyUrl;
  }
  const params = new URLSearchParams(window.location.search);
  const proxy = params.get("proxy");
  if (proxy) {
    return normalizeProxyUrl(proxy);
  }
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
  }
  return window.location.origin;
}

/** Set a new proxy URL at runtime (updates query param too). */
export function setProxyUrl(url: string): void {
  const cleaned = normalizeProxyUrl(url);
  _overrideProxyUrl = cleaned;
  // Sync to URL query param without page reload
  const params = new URLSearchParams(window.location.search);
  params.set("proxy", cleaned);
  window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
}

/** Returns true if a proxy URL is explicitly configured (via query param or override). */
export function hasProxyUrl(): boolean {
  return (
    _overrideProxyUrl !== null ||
    new URLSearchParams(window.location.search).has("proxy")
  );
}

export function isRemoteProxy(): boolean {
  return (
    _overrideProxyUrl !== null ||
    new URLSearchParams(window.location.search).has("proxy")
  );
}

/** Scoped localStorage key: "studio:{proxyOrigin}:{suffix}" */
export function studioKey(suffix: string): string {
  const raw = getBaseUrl();
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    // Invalid URL (bad port, malformed, etc.) - keep keys namespaced by the
    // raw string so we don't leak across servers, but avoid crashing render.
    origin = `invalid:${raw}`;
  }
  return studioKeyForOrigin(origin, suffix);
}

/** Build the studio-scoped key for a known origin. Exported so the OAuth
 *  callback path (which doesn't have a `getBaseUrl()` context) can reuse
 *  the same format. */
export function studioKeyForOrigin(origin: string, suffix: string): string {
  return `studio:${origin}:${suffix}`;
}

// ── Auth (scoped per proxy) ──

export function getAuthMethod(): "oauth" | "bearer" | "custom" {
  return (
    (localStorage.getItem(studioKey("auth_method")) as
      | "oauth"
      | "bearer"
      | "custom") || "oauth"
  );
}

export function setAuthMethod(method: "oauth" | "bearer" | "custom") {
  localStorage.setItem(studioKey("auth_method"), method);
}

export function getBearerToken(): string {
  return localStorage.getItem(studioKey("bearer_token")) || "";
}

export function setBearerToken(token: string) {
  if (token) {
    localStorage.setItem(studioKey("bearer_token"), token);
  } else {
    localStorage.removeItem(studioKey("bearer_token"));
  }
  resetSession();
}

export function getOAuthAccessToken(): string {
  return localStorage.getItem(studioKey("oauth_access_token")) || "";
}

export function getCustomHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(studioKey("custom_headers"));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") result[k] = v;
        }
        return result;
      }
    }
  } catch {
    /* invalid JSON — ignore */
  }
  return {};
}

export function setCustomHeaders(headers: string) {
  if (headers.trim()) {
    localStorage.setItem(studioKey("custom_headers"), headers);
  } else {
    localStorage.removeItem(studioKey("custom_headers"));
  }
}

/**
 * Returns the active token based on current auth method.
 * All reads are scoped to the current proxy URL.
 */
export function getActiveToken(): string {
  const method = getAuthMethod();
  if (method === "oauth") {
    return getOAuthAccessToken();
  }
  return getBearerToken();
}

// ── OAuth token storage (scoped per proxy) ──

export function saveOAuthTokens(
  tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type: string;
  },
  clientId: string,
) {
  localStorage.setItem(studioKey("oauth_access_token"), tokens.access_token);
  localStorage.setItem(studioKey("oauth_token_type"), tokens.token_type);
  localStorage.setItem(studioKey("oauth_client_id"), clientId);
  if (tokens.refresh_token) {
    localStorage.setItem(
      studioKey("oauth_refresh_token"),
      tokens.refresh_token,
    );
  }
  if (tokens.expires_in) {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    localStorage.setItem(studioKey("oauth_expires_at"), String(expiresAt));
  }
  if (tokens.scope) {
    localStorage.setItem(studioKey("oauth_scope"), tokens.scope);
  }
}

export function loadOAuthTokens() {
  return {
    accessToken: localStorage.getItem(studioKey("oauth_access_token")),
    refreshToken: localStorage.getItem(studioKey("oauth_refresh_token")),
    expiresAt:
      Number(localStorage.getItem(studioKey("oauth_expires_at"))) || null,
    scope: localStorage.getItem(studioKey("oauth_scope")),
    clientId: localStorage.getItem(studioKey("oauth_client_id")),
  };
}

export function clearOAuthTokens() {
  for (const suffix of [
    "oauth_access_token",
    "oauth_refresh_token",
    "oauth_expires_at",
    "oauth_scope",
    "oauth_token_type",
    "oauth_client_id",
  ]) {
    localStorage.removeItem(studioKey(suffix));
  }
}

// ── PKCE state storage (scoped per proxy) ──

export function savePKCEState(codeVerifier: string, state: string) {
  localStorage.setItem(studioKey("pkce_code_verifier"), codeVerifier);
  localStorage.setItem(studioKey("pkce_state"), state);
}

export function loadPKCEState() {
  return {
    codeVerifier: localStorage.getItem(studioKey("pkce_code_verifier")),
    state: localStorage.getItem(studioKey("pkce_state")),
  };
}

export function clearPKCEState() {
  localStorage.removeItem(studioKey("pkce_code_verifier"));
  localStorage.removeItem(studioKey("pkce_state"));
}

// ── Pending OAuth flow state (survives full-page redirect) ──
// Uses a global prefix (not proxy-scoped) because the callback page
// has no ?proxy= param and only one redirect flow can be in-flight.

const PENDING_PREFIX = "studio:pending_oauth:";

export function saveOAuthFlowState(params: {
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  proxyUrl: string;
  codeVerifier: string;
  state: string;
}) {
  localStorage.setItem(`${PENDING_PREFIX}token_endpoint`, params.tokenEndpoint);
  localStorage.setItem(`${PENDING_PREFIX}client_id`, params.clientId);
  localStorage.setItem(`${PENDING_PREFIX}redirect_uri`, params.redirectUri);
  localStorage.setItem(`${PENDING_PREFIX}proxy_url`, params.proxyUrl);
  localStorage.setItem(`${PENDING_PREFIX}code_verifier`, params.codeVerifier);
  localStorage.setItem(`${PENDING_PREFIX}state`, params.state);
}

export function loadOAuthFlowState() {
  return {
    tokenEndpoint: localStorage.getItem(`${PENDING_PREFIX}token_endpoint`),
    clientId: localStorage.getItem(`${PENDING_PREFIX}client_id`),
    redirectUri: localStorage.getItem(`${PENDING_PREFIX}redirect_uri`),
    proxyUrl: localStorage.getItem(`${PENDING_PREFIX}proxy_url`),
    codeVerifier: localStorage.getItem(`${PENDING_PREFIX}code_verifier`),
    state: localStorage.getItem(`${PENDING_PREFIX}state`),
  };
}

export function clearOAuthFlowState() {
  for (const key of [
    "token_endpoint",
    "client_id",
    "redirect_uri",
    "proxy_url",
    "code_verifier",
    "state",
  ]) {
    localStorage.removeItem(`${PENDING_PREFIX}${key}`);
  }
}

/** Save OAuth tokens scoped to a specific proxy URL (used by callback page). */
export function saveOAuthTokensForProxy(
  proxyUrl: string,
  tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type: string;
  },
  clientId: string,
) {
  const origin = new URL(proxyUrl).origin;
  const key = (suffix: string) => studioKeyForOrigin(origin, suffix);
  localStorage.setItem(key("oauth_access_token"), tokens.access_token);
  localStorage.setItem(key("oauth_token_type"), tokens.token_type);
  localStorage.setItem(key("oauth_client_id"), clientId);
  if (tokens.refresh_token) {
    localStorage.setItem(key("oauth_refresh_token"), tokens.refresh_token);
  }
  if (tokens.expires_in) {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    localStorage.setItem(key("oauth_expires_at"), String(expiresAt));
  }
  if (tokens.scope) {
    localStorage.setItem(key("oauth_scope"), tokens.scope);
  }
}

// ── MCP JSON-RPC ──

// Session lifecycle is a single state machine. All callers go through
// `ensureSession()`, which serializes concurrent handshakes. `notifications/
// initialized` is sent with the session id captured by this handshake, not
// read from module state, so a reset mid-flight can't mis-route it.
type SessionState =
  | { kind: "idle" }
  | { kind: "connecting"; promise: Promise<string> }
  | { kind: "connected"; sessionId: string };

let rpcId = 0;
let session: SessionState = { kind: "idle" };

function currentSessionId(): string | null {
  return session.kind === "connected" ? session.sessionId : null;
}

/** True only when a session is established and ready for non-init RPCs. */
function isConnected(): boolean {
  return session.kind === "connected";
}

/**
 * Returns the fetch URL for MCP requests. Always routes through the local
 * Rust proxy, which runs on the same origin as Studio (zero CORS) and lives
 * on the user's machine (so localhost MCP servers reach).
 */
function getMcpFetchUrl(): string {
  return `/api/mcp-proxy?url=${encodeURIComponent(getBaseUrl())}`;
}

function buildHeaders(overrideSessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const token = getActiveToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const sid = overrideSessionId ?? currentSessionId();
  if (sid) headers["mcp-session-id"] = sid;
  Object.assign(headers, getCustomHeaders());
  return headers;
}

async function rawMcpPost(
  method: string,
  params: Record<string, unknown> = {},
  overrideSessionId?: string,
): Promise<Response> {
  return fetch(getMcpFetchUrl(), {
    method: "POST",
    headers: buildHeaders(overrideSessionId),
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
}

/** Parse a response that may be JSON or SSE-wrapped JSON (data: {...}\n\n) */
async function parseResponse(resp: Response): Promise<Record<string, unknown>> {
  const contentType = resp.headers.get("content-type") || "";
  const text = await resp.text();

  // Non-OK responses with non-JSON bodies (e.g. plain text "Unauthorized")
  if (
    !resp.ok &&
    !contentType.includes("application/json") &&
    !contentType.includes("text/event-stream") &&
    !text.trimStart().startsWith("{") &&
    !text.trimStart().startsWith("data:")
  ) {
    const preview = text.slice(0, 200).trim() || `HTTP ${resp.status}`;
    throw new Error(preview);
  }

  if (contentType.includes("text/event-stream") || text.startsWith("data:")) {
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr) {
          try {
            return JSON.parse(jsonStr);
          } catch {
            // continue to next data line
          }
        }
      }
    }
    throw new Error("No valid JSON found in SSE response");
  }

  try {
    return JSON.parse(text);
  } catch {
    const preview = text.slice(0, 200).trim() || `HTTP ${resp.status}`;
    throw new Error(preview);
  }
}

async function doHandshake(): Promise<string> {
  const resp = await rawMcpPost("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "mcp-studio", version: "1.0.0" },
  });

  const data = await parseResponse(resp);
  if (data.error)
    throw new Error(
      (data.error as { message?: string }).message ||
        JSON.stringify(data.error),
    );

  let sid = resp.headers.get("mcp-session-id");
  // Some servers return session ID in the JSON-RPC response body
  // (e.g. as _meta.sessionId) when CORS doesn't expose the header
  if (!sid) {
    const meta = (data.result as Record<string, unknown>)?._meta as
      | Record<string, unknown>
      | undefined;
    const bodySid = meta?.sessionId as string | undefined;
    if (bodySid) sid = bodySid;
  }
  if (!sid) {
    throw new Error(
      "Server did not return Mcp-Session-Id (header or _meta.sessionId)",
    );
  }

  // Send notifications/initialized using THIS handshake's session id, not
  // whatever happens to be in module state when this fetch runs. Concurrent
  // resets or a parallel handshake mustn't be able to mis-route it.
  await fetch(getMcpFetchUrl(), {
    method: "POST",
    headers: buildHeaders(sid),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  return sid;
}

/** Returns a session id, performing the handshake if necessary. Concurrent
 *  callers share one in-flight handshake. */
async function ensureSession(): Promise<string> {
  if (session.kind === "connected") return session.sessionId;
  if (session.kind === "connecting") return session.promise;

  const promise = doHandshake();
  session = { kind: "connecting", promise };
  try {
    const sid = await promise;
    // Only commit if we're still the in-flight handshake. If someone reset
    // us mid-flight, drop the result rather than clobber a newer state.
    if (session.kind === "connecting" && session.promise === promise) {
      session = { kind: "connected", sessionId: sid };
    }
    return sid;
  } catch (e) {
    if (session.kind === "connecting" && session.promise === promise) {
      session = { kind: "idle" };
    }
    throw e;
  }
}

/** Drop any cached session. An in-flight handshake will detect the reset and
 *  discard its result rather than clobber a newer state. */
export function resetSession(): void {
  session = { kind: "idle" };
}

/** Force a fresh handshake. Used by Retry and after token changes. */
export async function mcpInitialize(): Promise<void> {
  resetSession();
  await ensureSession();
}

export type McpHealth =
  | "checking"
  | "connected"
  | "disconnected"
  | "unauthorized";

/**
 * Live MCP server probe. Observes session state instead of driving it: if
 * no session is established yet, reports "checking" and lets `loadAll` own
 * the handshake. This prevents the probe's `id: -1` `tools/list` from
 * racing with `initialize`+`notifications/initialized` on reload and
 * poisoning the rmcp session.
 *
 * Categories:
 *   - no session yet    -> checking (loadAll will handshake)
 *   - 401 / 403         -> unauthorized (token issue)
 *   - 5xx / fetch throw -> disconnected (server / gateway down)
 *   - everything else   -> connected
 */
export async function probeMcpHealth(signal?: AbortSignal): Promise<McpHealth> {
  if (!isConnected()) {
    reportHealth("checking");
    return "checking";
  }
  let status: McpHealth;
  try {
    const resp = await fetch(getMcpFetchUrl(), {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: -1,
        method: "tools/list",
        params: {},
      }),
      signal,
    });
    if (resp.status === 401 || resp.status === 403) status = "unauthorized";
    else if (resp.status >= 500) status = "disconnected";
    else status = "connected";
  } catch (e) {
    status = classifyError(e);
  }
  reportHealth(status);
  return status;
}

/** Match auth-shaped errors so a 401 during `initialize` surfaces as
 *  `unauthorized` rather than a generic `disconnected`. */
function classifyError(e: unknown): McpHealth {
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  if (
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes(" 401") ||
    msg.startsWith("401") ||
    msg.includes(" 403") ||
    msg.startsWith("403")
  ) {
    return "unauthorized";
  }
  return "disconnected";
}

async function rawMcpCall(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  let resp: Response;
  try {
    await ensureSession();
    resp = await rawMcpPost(method, params);
  } catch (e) {
    reportHealth(classifyError(e));
    throw e;
  }
  // We got an HTTP response back - server is reachable. Classify by
  // status so a stale token still shows up as `unauthorized` even when
  // the body otherwise looks fine.
  if (resp.status === 401 || resp.status === 403) {
    reportHealth("unauthorized");
  } else if (resp.status >= 500) {
    reportHealth("disconnected");
  } else {
    reportHealth("connected");
  }
  const data = await parseResponse(resp);
  if (data.error)
    throw new Error(
      (data.error as { message?: string }).message ||
        JSON.stringify(data.error),
    );
  return data.result;
}

export async function mcpCall(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return recordedMcpCall(rawMcpCall, method, params, "user");
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export async function listTools(): Promise<McpToolInfo[]> {
  const result = (await mcpCall("tools/list")) as { tools?: McpToolInfo[] };
  const tools = result.tools || [];
  // Normalize: MCP spec uses _meta, copy to meta for backward compat
  for (const t of tools) {
    if (t._meta && !t.meta) t.meta = t._meta;
  }
  return tools;
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  source: Source = "user",
): Promise<unknown> {
  return recordedMcpCall(
    rawMcpCall,
    "tools/call",
    { name, arguments: args },
    source,
  );
}

export interface McpResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  meta?: Record<string, unknown>;
}

export async function listResources(): Promise<McpResourceInfo[]> {
  const result = (await mcpCall("resources/list")) as {
    resources?: McpResourceInfo[];
  };
  return result.resources || [];
}

export async function readResource(uri: string): Promise<unknown> {
  return mcpCall("resources/read", { uri });
}
