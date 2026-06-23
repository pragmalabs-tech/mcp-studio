/**
 * Client for the backend control WebSocket at /api/ws.
 * The server pushes FrontendAction messages; the frontend dispatches them.
 * Reconnects automatically on disconnect so the backend always has an active
 * client to target after the user refreshes or the server restarts.
 */

export type FrontendAction = { type: "run_test"; data: { test_id: string } };

const RECONNECT_DELAY_MS = 2000;

export function connectControlSocket(
  onAction: (action: FrontendAction) => void,
): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (stopped) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

    ws.onmessage = (event) => {
      try {
        const action = JSON.parse(event.data as string) as FrontendAction;
        onAction(action);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!stopped) {
        retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    ws?.close();
  };
}
