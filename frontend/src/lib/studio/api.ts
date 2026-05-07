/**
 * Studio API — communicates exclusively with the MCP proxy.
 *
 * All state (auth tokens, session, custom headers) is scoped per proxy URL
 * and stored under the "mcpr_studio:" localStorage prefix to avoid collision
 * with mcpr-cloud's own auth (cookie-based JWT).
 */

// ── Proxy URL ──

/** Mutable proxy URL set at runtime via setProxyUrl(). */
let _overrideProxyUrl: string | null = null;

export function getBaseUrl(): string {
  if (_overrideProxyUrl) {
    return _overrideProxyUrl;
  }
  const params = new URLSearchParams(window.location.search);
  const proxy = params.get("proxy");
  if (proxy) {
    return proxy.replace(/\/+$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
  }
  return window.location.origin;
}

/** Set a new proxy URL at runtime (updates query param too). */
export function setProxyUrl(url: string): void {
  let cleaned = url.replace(/\/+$/, "");
  // Auto-prepend protocol when not provided:
  // - localhost/127.0.0.1/0.0.0.0/::1 → http://
  // - everything else (domains) → https://
  if (cleaned && !/^https?:\/\//i.test(cleaned)) {
    const host = cleaned.split("/")[0].split(":")[0].toLowerCase();
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1";
    cleaned = `${isLocal ? "http" : "https"}://${cleaned}`;
  }
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

/** Scoped localStorage key: "mcpr_studio:{proxyOrigin}:{suffix}" */
function studioKey(suffix: string): string {
  const origin = new URL(getBaseUrl()).origin;
  return `mcpr_studio:${origin}:${suffix}`;
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

const PENDING_PREFIX = "mcpr_studio:pending_oauth:";

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
  const key = (suffix: string) => `mcpr_studio:${origin}:${suffix}`;
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

let rpcId = 0;
let sessionId: string | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Returns the fetch URL for MCP requests. Always routes through the local
 * Rust proxy, which runs on the same origin as Studio (zero CORS) and lives
 * on the user's machine (so localhost MCP servers reach).
 */
function getMcpFetchUrl(): string {
  return `/api/mcp-proxy?url=${encodeURIComponent(getBaseUrl())}`;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const token = getActiveToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  Object.assign(headers, getCustomHeaders());
  return headers;
}

async function rawMcpPost(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(getMcpFetchUrl(), {
    method: "POST",
    headers: buildHeaders(),
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

async function ensureSession(): Promise<void> {
  if (sessionId) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const resp = await rawMcpPost("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mcpr-studio", version: "1.0.0" },
    });

    // Capture session ID from response header or JSON body
    const sid = resp.headers.get("mcp-session-id");
    if (sid) sessionId = sid;

    const data = await parseResponse(resp);
    if (data.error)
      throw new Error(
        (data.error as { message?: string }).message ||
          JSON.stringify(data.error),
      );

    // Some servers return session ID in the JSON-RPC response body
    // (e.g. as _meta.sessionId) when CORS doesn't expose the header
    if (!sessionId) {
      const meta = (data.result as Record<string, unknown>)?._meta as
        | Record<string, unknown>
        | undefined;
      const bodySid = meta?.sessionId as string | undefined;
      if (bodySid) sessionId = bodySid;
    }

    if (!sessionId) {
      console.warn(
        "[mcpr-studio] No mcp-session-id in response headers. " +
          "Cross-origin requests are routed through the backend proxy to handle this.",
      );
    }

    await fetch(getMcpFetchUrl(), {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

/** Reset MCP session (e.g. after token change) */
export function resetSession() {
  sessionId = null;
  initPromise = null;
}

/** Explicitly initialize the MCP session (resets first if needed). */
export async function mcpInitialize(): Promise<void> {
  resetSession();
  await ensureSession();
}

export async function mcpCall(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  await ensureSession();
  const resp = await rawMcpPost(method, params);
  const data = await parseResponse(resp);
  if (data.error)
    throw new Error(
      (data.error as { message?: string }).message ||
        JSON.stringify(data.error),
    );
  return data.result;
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
): Promise<unknown> {
  return mcpCall("tools/call", { name, arguments: args });
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
