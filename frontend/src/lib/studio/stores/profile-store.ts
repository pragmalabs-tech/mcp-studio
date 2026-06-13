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
  registerSilentRefreshCallback,
} from "../api";
import {
  fetchAuthStatus,
  fetchTunnelStatus,
  authLogout,
  startTunnel as apiStartTunnel,
} from "../cloud-api";
import {
  listProfiles,
  activateProfile as apiActivateProfile,
  updateProfile as apiUpdateProfile,
  type Profile,
  type ProfileAuth,
} from "../profiles-api";
import {
  checkCompliance,
  decodeToken,
  type OAuthDebugEvent,
} from "../oauth-debug";
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
} from "../oauth";
import { useWidgetStore } from "./widget-store";
import type { AuthMethod, OAuthState } from "./types";
import { generateRandomString } from "@/lib/utils";

export type { AuthMethod, OAuthState };

const PROFILE_AUTH_MIGRATION_FLAG = "studio:profile_auth_migrated_v1";

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

interface ProfileState {
  proxyUrl: string;
  proxyConnected: boolean;
  profiles: Profile[];
  activeProfileId: string | null;
  authMethod: AuthMethod;
  token: string;
  tokenDraft: string;
  oauth: OAuthState;
  oauthDebugEvents: OAuthDebugEvent[];
  oauthDebugOpen: boolean;
  cloudAuth: { email: string } | null;
  signInOpen: boolean;
  publishOpen: boolean;
  tunnel: {
    status: "idle" | "connecting" | "active" | "error";
    url: string | null;
    subdomain: string | null;
    error: string | null;
  };

  setProxyUrl: (url: string) => void;
  refreshProfiles: () => Promise<void>;
  activateAndApply: (id: string) => Promise<void>;
  updateActiveProfileAuth: (auth: ProfileAuth) => Promise<void>;
  setAuthMethod: (method: AuthMethod) => void;
  setToken: (draft: string) => void;
  saveToken: () => Promise<void>;
  clearToken: () => Promise<void>;
  addOAuthDebugEvent: (event: OAuthDebugEvent) => void;
  clearOAuthDebugEvents: () => void;
  setOAuthDebugOpen: (open: boolean) => void;
  setOAuthClientId: (id: string) => void;
  setOAuthClientSecret: (secret: string) => void;
  setOAuthCustomHeaders: (headers: string) => void;
  applyCustomHeaders: () => Promise<void>;
  setOAuthRedirectUri: (uri: string) => void;
  setOAuthSelectedScopes: (scopes: string[]) => void;
  startOAuthFlow: () => Promise<void>;
  handleOAuthCallback: (code: string, state: string) => Promise<void>;
  refreshOAuthToken: () => Promise<void>;
  signOut: () => void;
  testOAuthEndpoints: () => Promise<void>;
  hydrateCloudAuth: () => Promise<void>;
  hydrateTunnel: () => Promise<void>;
  setSignInOpen: (open: boolean) => void;
  setPublishOpen: (open: boolean) => void;
  cloudAuthCompleted: (email: string) => void;
  cloudSignOut: () => Promise<void>;
  startTunnel: (subdomain?: string) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  proxyUrl: hasProxyUrl() ? getBaseUrl() : "",
  proxyConnected: hasProxyUrl(),
  profiles: [] as Profile[],
  activeProfileId: null as string | null,

  authMethod: readAuthMethod(),
  token: getBearerToken(),
  tokenDraft: getBearerToken(),
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

  cloudAuth: null,
  signInOpen: false,
  publishOpen: false,
  tunnel: { status: "idle", url: null, subdomain: null, error: null },

  // ── Actions ──

  setProxyUrl: (url: string) => {
    apiSetProxyUrl(url);
    set({ proxyUrl: getBaseUrl(), proxyConnected: true });
    resetSession();
    useWidgetStore.getState().loadAll();
  },

  refreshProfiles: async () => {
    try {
      const resp = await listProfiles();
      set({ profiles: resp.profiles, activeProfileId: resp.active_id });

      const { proxyUrl } = get();
      if (!proxyUrl && resp.active_id) {
        const active = resp.profiles.find((p) => p.id === resp.active_id);
        if (active && active.server_url) {
          get().setProxyUrl(active.server_url);
        }
      }

      if (!localStorage.getItem(PROFILE_AUTH_MIGRATION_FLAG)) {
        const originalUrl = get().proxyUrl;
        for (const p of resp.profiles) {
          if (p.auth || !p.server_url) continue;
          apiSetProxyUrl(p.server_url);
          const snapshot = snapshotOriginAuthForMigration();
          if (snapshot) {
            try {
              await apiUpdateProfile(p.id, { auth: snapshot });
            } catch {
              /* migration is best-effort */
            }
          }
        }
        if (originalUrl) {
          apiSetProxyUrl(originalUrl);
        }
        localStorage.setItem(PROFILE_AUTH_MIGRATION_FLAG, "1");
        const after = await listProfiles();
        set({ profiles: after.profiles, activeProfileId: after.active_id });
      }

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
      /* backend not ready yet */
    }
  },

  activateAndApply: async (id: string) => {
    const resp = await apiActivateProfile(id);
    set({ profiles: resp.profiles, activeProfileId: resp.active_id });
    const active = resp.profiles.find((p) => p.id === resp.active_id);
    if (!active) return;
    if (active.server_url) {
      get().setProxyUrl(active.server_url);
    }
    applyProfileAuthToLocalStorage(active.auth);
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

  setAuthMethod: (method) => set({ authMethod: method }),

  setToken: (draft) => set({ tokenDraft: draft }),

  saveToken: async () => {
    const { tokenDraft } = get();
    await get().updateActiveProfileAuth({
      method: "bearer",
      token: tokenDraft,
    });
    useWidgetStore.getState().setAuthOpen(!tokenDraft);
    set({ token: tokenDraft });
    useWidgetStore.getState().loadAll();
  },

  clearToken: async () => {
    await get().updateActiveProfileAuth({ method: "bearer", token: "" });
    set({ token: "", tokenDraft: "" });
    useWidgetStore.getState().setAuthOpen(true);
    useWidgetStore.getState().loadAll();
  },

  // ── OAuth Actions ──

  addOAuthDebugEvent: (event) => {
    set((s) => {
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

  setOAuthClientId: (id) =>
    set((s) => ({ oauth: { ...s.oauth, clientId: id } })),

  setOAuthClientSecret: (secret) =>
    set((s) => ({ oauth: { ...s.oauth, clientSecret: secret } })),

  setOAuthCustomHeaders: (headers) =>
    set((s) => ({ oauth: { ...s.oauth, customHeaders: headers } })),

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
    useWidgetStore.getState().loadAll();
  },

  setOAuthRedirectUri: (uri) =>
    set((s) => ({ oauth: { ...s.oauth, redirectUri: uri } })),

  setOAuthSelectedScopes: (scopes) =>
    set((s) => ({ oauth: { ...s.oauth, selectedScopes: scopes } })),

  startOAuthFlow: async () => {
    const baseUrl = getBaseUrl();
    const onEvent = get().addOAuthDebugEvent;
    const effectiveRedirectUri = get().oauth.redirectUri || getRedirectUri();

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

    saveOAuthFlowState({
      tokenEndpoint: endpoints.tokenEndpoint,
      clientId,
      redirectUri: effectiveRedirectUri,
      proxyUrl: baseUrl,
      codeVerifier,
      state,
    });

    const opened = window.open(authUrl, "_blank");
    if (!opened) {
      window.location.href = authUrl;
    }
  },

  handleOAuthCallback: async (code, state) => {
    const baseUrl = getBaseUrl();
    const onEvent = get().addOAuthDebugEvent;
    const effectiveRedirectUri = get().oauth.redirectUri || getRedirectUri();

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

      saveOAuthTokens(tokens, clientId, endpoints.tokenEndpoint);
      removePKCE();

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

      useWidgetStore.getState().loadAll();
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

      saveOAuthTokens(tokens, clientId, endpoints.tokenEndpoint);

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
    useWidgetStore.getState().loadAll();
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
}));

registerSilentRefreshCallback((expiresAt) => {
  useProfileStore.setState((s) => ({
    oauth: { ...s.oauth, expiresAt },
  }));
});

// Restart health polling whenever auth changes so the probe uses the new token.
// Wired here (not in health.ts) to avoid a circular import through api.ts.
import("../health").then(({ useHealthStore }) => {
  let prevToken = useProfileStore.getState().oauth.accessToken;
  let prevMethod = useProfileStore.getState().authMethod;
  useProfileStore.subscribe((state) => {
    const nextToken = state.oauth.accessToken;
    const nextMethod = state.authMethod;
    if (nextToken !== prevToken || nextMethod !== prevMethod) {
      prevToken = nextToken;
      prevMethod = nextMethod;
      useHealthStore.getState()._start();
    }
  });
});
