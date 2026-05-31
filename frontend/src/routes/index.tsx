import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { StudioLayout } from "@/components/studio/studio-layout";
import { useProfileStore } from "@/lib/studio/stores/profile-store";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import {
  getBaseUrl,
  loadOAuthTokens,
  studioKeyForOrigin,
} from "@/lib/studio/api";
import { decodeToken } from "@/lib/studio/oauth-debug";

export const Route = createFileRoute("/")({
  component: StudioPage,
  validateSearch: (search: Record<string, unknown>) => ({
    proxy: (search.proxy as string) || undefined,
    tags: (search.tags as string) || undefined,
  }),
});

function StudioPage() {
  const loadAll = useWidgetStore((s) => s.loadAll);
  const proxyConnected = useProfileStore((s) => s.proxyConnected);
  const hydrateCloudAuth = useProfileStore((s) => s.hydrateCloudAuth);
  const hydrateTunnel = useProfileStore((s) => s.hydrateTunnel);
  const refreshProfiles = useProfileStore((s) => s.refreshProfiles);

  useEffect(() => {
    if (proxyConnected) {
      loadAll();
    }
  }, [loadAll, proxyConnected]);

  // Cloud auth + tunnel + profiles hydration on mount.
  useEffect(() => {
    hydrateCloudAuth();
    hydrateTunnel();
    refreshProfiles();
  }, [hydrateCloudAuth, hydrateTunnel, refreshProfiles]);

  // Hydrate the store when the callback tab saves tokens to localStorage.
  // storage event = optimistic fast path. visibilitychange = reliable catch-up
  // when the callback tab closed before its storage event propagated.
  useEffect(() => {
    if (!proxyConnected) return;

    const proxyOrigin = new URL(getBaseUrl()).origin;
    const tokenKey = studioKeyForOrigin(proxyOrigin, "oauth_access_token");

    const hydrate = () => {
      const saved = loadOAuthTokens();
      if (!saved.accessToken) return;
      const current = useProfileStore.getState().oauth;
      if (
        current.status === "connected" &&
        current.accessToken === saved.accessToken
      ) {
        return;
      }
      useProfileStore.setState((s) => ({
        oauth: {
          ...s.oauth,
          status: "connected",
          accessToken: saved.accessToken,
          refreshToken: saved.refreshToken,
          expiresAt: saved.expiresAt,
          clientId: saved.clientId || s.oauth.clientId,
          error: null,
          decodedToken: decodeToken(saved.accessToken!),
        },
      }));
      useWidgetStore.setState({ authOpen: false });
      loadAll();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === tokenKey && e.newValue) hydrate();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") hydrate();
    };

    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadAll, proxyConnected]);

  return <StudioLayout />;
}
