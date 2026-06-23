import { useEffect } from "react";
import { connectControlSocket } from "@/lib/studio/control-ws";
import { useTestStore } from "@/lib/studio/stores/test-store";

/**
 * Owns the backend control WebSocket connection.
 * Maps incoming server actions to store actions — this is the only place
 * that knows about the WS protocol. Components react to store state.
 * Renders nothing.
 */
export function Realtime() {
  const triggerTest = useTestStore((s) => s.triggerTest);

  useEffect(() => {
    return connectControlSocket((action) => {
      if (action.type === "run_test") {
        triggerTest(action.data.test_id);
      }
    });
  }, [triggerTest]);

  return null;
}
