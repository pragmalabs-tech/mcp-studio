import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { StudioLayout } from "@/components/studio/studio-layout";
import { useStudioStore } from "@/lib/studio/store";
import { getBaseUrl, loadOAuthTokens } from "@/lib/studio/api";
import { decodeToken } from "@/lib/studio/oauth-debug";

export const Route = createFileRoute("/")({
  component: StudioPage,
  validateSearch: (search: Record<string, unknown>) => ({
    proxy: (search.proxy as string) || undefined,
  }),
});

function StudioPage() {
  const loadAll = useStudioStore((s) => s.loadAll);
  const proxyConnected = useStudioStore((s) => s.proxyConnected);
  const hydrateCloudAuth = useStudioStore((s) => s.hydrateCloudAuth);
  const hydrateTunnel = useStudioStore((s) => s.hydrateTunnel);

  useEffect(() => {
    if (proxyConnected) {
      loadAll();
    }
  }, [loadAll, proxyConnected]);

  // Cloud auth + tunnel hydration on mount.
  useEffect(() => {
    hydrateCloudAuth();
    hydrateTunnel();
  }, [hydrateCloudAuth, hydrateTunnel]);

  // Hydrate the store when the callback tab saves tokens to localStorage.
  // storage event = optimistic fast path. visibilitychange = reliable catch-up
  // when the callback tab closed before its storage event propagated.
  useEffect(() => {
    if (!proxyConnected) return;

    const proxyOrigin = new URL(getBaseUrl()).origin;
    const tokenKey = `mcpr_studio:${proxyOrigin}:oauth_access_token`;

    const hydrate = () => {
      const saved = loadOAuthTokens();
      if (!saved.accessToken) return;
      const current = useStudioStore.getState().oauth;
      if (
        current.status === "connected" &&
        current.accessToken === saved.accessToken
      ) {
        return;
      }
      useStudioStore.setState((s) => ({
        authOpen: false,
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
