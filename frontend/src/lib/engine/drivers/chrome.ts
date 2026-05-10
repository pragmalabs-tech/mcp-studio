import type { Action, ActionKind } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";
import type { Driver, DriverContext, DriveOutcome } from "./types";

const KINDS: ActionKind[] = [
  KIND.CONFIG_UPDATE,
  KIND.AUTH_UPDATE,
  KIND.SIDEBAR_SELECT,
  KIND.EDITOR_SET_ARGS,
];

function applyConfig(
  store: DriverContext["store"],
  patch: Record<string, unknown>,
) {
  if (typeof patch.platform === "string") {
    store.setPlatform(patch.platform as "openai" | "claude");
  }
  if (typeof patch.theme === "string") store.setTheme(patch.theme);
  if (typeof patch.locale === "string") store.setLocale(patch.locale);
  if (typeof patch.displayMode === "string")
    store.setDisplayMode(patch.displayMode);
  if (typeof patch.strictMode === "boolean")
    store.setStrictMode(patch.strictMode);
  const vp = patch.viewport as
    | { preset?: string; width?: number; height?: number }
    | undefined;
  if (vp) {
    if (vp.preset) store.setViewportPreset(vp.preset);
    if (typeof vp.width === "number" || typeof vp.height === "number") {
      store.setViewportPreset("custom");
      store.setViewportCustom({ width: vp.width, height: vp.height });
    }
  }
}

// Auth is profile-scoped now: in-timeline `auth.update` events from old
// recordings no longer drive replay. The driver still acknowledges the kind
// so old test JSON loads without "no driver registered" errors.
function applyAuth(
  _store: DriverContext["store"],
  _patch: Record<string, unknown>,
) {
  /* intentionally empty */
}

function findToolByName(
  store: DriverContext["store"],
  name: string,
): unknown | null {
  const tool = store.getState().tools.find((t) => t.name === name);
  if (tool) return { type: "tool", tool };
  const res = store
    .getState()
    .resources.find((r) => r.name === name || r.uri === name);
  if (res) return { type: "resource", resource: res };
  return null;
}

export const chromeDriver: Driver<Action> = {
  kinds: KINDS,
  async drive(action, ctx) {
    const t0 = performance.now();
    try {
      switch (action.kind) {
        case "config.update":
          applyConfig(
            ctx.store,
            action.patch as unknown as Record<string, unknown>,
          );
          break;
        case "auth.update":
          applyAuth(
            ctx.store,
            action.patch as unknown as Record<string, unknown>,
          );
          break;
        case "sidebar.select": {
          const item = findToolByName(ctx.store, action.selection.name);
          if (!item) {
            return {
              ok: false,
              reason: `selection "${action.selection.name}" not found in catalog`,
              durationMs: performance.now() - t0,
            } satisfies DriveOutcome;
          }
          ctx.store.select(item);
          break;
        }
        case "editor.set_args": {
          const value = action.value;
          ctx.store.setEditorValue(
            typeof value === "string" ? value : JSON.stringify(value, null, 2),
          );
          break;
        }
      }
      return {
        ok: true,
        durationMs: performance.now() - t0,
      } satisfies DriveOutcome;
    } catch (err) {
      return {
        ok: false,
        reason: (err as Error).message,
        durationMs: performance.now() - t0,
      } satisfies DriveOutcome;
    }
  },
};
