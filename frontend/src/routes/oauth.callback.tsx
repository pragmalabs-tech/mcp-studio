import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  loadOAuthFlowState,
  clearOAuthFlowState,
  saveOAuthTokensForProxy,
} from "@/lib/studio/api";
import { exchangeCode } from "@/lib/studio/oauth";

export const Route = createFileRoute("/oauth/callback")({
  component: OAuthCallback,
});

function OAuthCallback() {
  const [status, setStatus] = useState<"processing" | "error" | "success">(
    "processing",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [retryUrl, setRetryUrl] = useState("/");

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    // Load persisted flow state
    const flow = loadOAuthFlowState();
    const studioUrl = flow.proxyUrl
      ? `/?proxy=${encodeURIComponent(flow.proxyUrl)}`
      : "/";
    setRetryUrl(studioUrl);

    if (error) {
      setStatus("error");
      setErrorMsg(errorDescription || error);
      clearOAuthFlowState();
      return;
    }

    if (!code || !state) {
      setStatus("error");
      setErrorMsg("Missing authorization code or state parameter.");
      clearOAuthFlowState();
      return;
    }

    if (
      !flow.tokenEndpoint ||
      !flow.clientId ||
      !flow.redirectUri ||
      !flow.proxyUrl
    ) {
      setStatus("error");
      setErrorMsg(
        "OAuth flow state not found. The session may have expired. Please try signing in again.",
      );
      clearOAuthFlowState();
      return;
    }

    if (!flow.state || flow.state !== state) {
      setStatus("error");
      setErrorMsg("OAuth state mismatch — possible CSRF attack. Try again.");
      clearOAuthFlowState();
      return;
    }

    if (!flow.codeVerifier) {
      setStatus("error");
      setErrorMsg("Missing PKCE code_verifier. Try signing in again.");
      clearOAuthFlowState();
      return;
    }

    try {
      const tokens = await exchangeCode(
        flow.tokenEndpoint,
        code,
        flow.redirectUri,
        flow.clientId,
        flow.codeVerifier,
        () => {}, // no debug panel on callback page
      );

      // Save tokens scoped to the proxy origin. This triggers a "storage"
      // event on the original Studio tab (if still open) so it can hydrate
      // the tokens immediately.
      saveOAuthTokensForProxy(
        flow.proxyUrl,
        tokens,
        flow.clientId,
        flow.tokenEndpoint,
      );
      clearOAuthFlowState();

      setStatus("success");

      // Try to close this tab — the original Studio tab picks up the tokens
      // via the storage event listener. If we can't close (browser restriction),
      // redirect to Studio instead.
      try {
        window.close();
      } catch {
        // ignore
      }
      // Fallback: if window.close() didn't work (e.g. not opened by script),
      // redirect after a short delay
      setTimeout(() => {
        window.location.href = studioUrl;
      }, 1000);
    } catch (e) {
      setStatus("error");
      setErrorMsg((e as Error).message);
      clearOAuthFlowState();
    }
  }

  if (status === "error") {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        <div className="text-center max-w-md px-4 space-y-3">
          <p className="text-destructive">Sign in failed: {errorMsg}</p>
          <a
            href={retryUrl}
            className="text-sm text-primary underline hover:no-underline"
          >
            Return to Studio
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen text-muted-foreground">
      <div className="text-center space-y-2">
        {status === "processing" && (
          <>
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm">Completing authorization...</p>
          </>
        )}
        {status === "success" && (
          <>
            <p className="text-green-500">Authorization successful</p>
            <p className="text-sm">Redirecting to Studio...</p>
          </>
        )}
      </div>
    </div>
  );
}
