/**
 * Opt-in debug logging for the recorder/replay surface. Off by default
 * to keep the production console clean; enable per-session in DevTools:
 *
 *     window.__mcprDebug = true;
 *
 * The widget-bridge JS has its own inline equivalent (it runs inside
 * the iframe and can't import). Both gate on the same window flag.
 */

interface DebugWindow {
  __mcprDebug?: boolean;
}

function enabled(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as DebugWindow).__mcprDebug)
  );
}

export function dbg(...args: unknown[]): void {
  if (!enabled()) return;
  console.log("[mcpr]", ...args);
}

export function dbgWarn(...args: unknown[]): void {
  if (!enabled()) return;
  console.warn("[mcpr]", ...args);
}
