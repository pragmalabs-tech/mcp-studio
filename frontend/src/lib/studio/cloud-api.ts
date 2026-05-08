/**
 * Frontend client for Studio's local backend at /api/auth/* and /api/tunnel/*.
 * The backend talks to api.mcpr.app for sign-in and to tunnel.mcpr.app for
 * the tunnel. The frontend only ever calls localhost:7777.
 */

export interface AuthStatus {
  email: string | null;
}

export interface TunnelInfo {
  url: string;
  subdomain: string | null;
  started_at: string;
}

export interface TunnelStatus {
  active: boolean;
  info: TunnelInfo | null;
}

export type TunnelEvent =
  | {
      type: "tunnel_request";
      id: string;
      ts: number;
      method: string;
      path: string;
      headers: [string, string][];
      body_preview: string;
    }
  | {
      type: "tunnel_response";
      id: string;
      ts: number;
      status: number;
      headers: [string, string][];
      body_preview: string;
    };

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body && typeof body.error === "string") msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return resp.json();
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const r = await fetch("/api/auth/status");
  return jsonOrThrow(r);
}

export async function authLogin(
  email: string,
): Promise<{ request_id: string }> {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return jsonOrThrow(r);
}

export async function authVerify(
  request_id: string,
  code: string,
): Promise<{ email: string }> {
  const r = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id, code }),
  });
  return jsonOrThrow(r);
}

export async function authLogout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function fetchTunnelStatus(): Promise<TunnelStatus> {
  const r = await fetch("/api/tunnel/status");
  return jsonOrThrow(r);
}

export interface TunnelEndpoint {
  id: string;
  name: string;
}

export async function fetchTunnelEndpoints(): Promise<TunnelEndpoint[]> {
  const r = await fetch("/api/tunnel/endpoints");
  return jsonOrThrow(r);
}

export async function startTunnel(
  mcp_url: string,
  subdomain?: string,
): Promise<TunnelInfo> {
  const r = await fetch("/api/tunnel/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mcp_url, subdomain: subdomain || null }),
  });
  return jsonOrThrow(r);
}

export function subscribeTunnelEvents(
  onEvent: (e: TunnelEvent) => void,
): () => void {
  const es = new EventSource("/api/tunnel/events");
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      // ignore malformed event
    }
  };
  return () => es.close();
}
