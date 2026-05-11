/**
 * studio driver — owns state.studio. User-driven shell mutations
 * (sidebar select, editor args, theme/viewport/locale, fixture mock).
 */

import type { Driver, State, StudioAction, StudioSlice } from "../types";

const DEFAULT_STUDIO: StudioSlice = {
  selected: null,
  editor: { args: {} },
  theme: "dark",
  viewport: { preset: "mobile" },
  displayMode: "inline",
  locale: "en-US",
  strictMode: false,
  mock: null,
};

function apply(state: State, action: StudioAction): State {
  switch (action.kind) {
    case "select":
      return withStudio(state, { selected: action.payload.selection });
    case "set_args":
      return withStudio(state, { editor: { args: action.payload.value } });
    case "set_mock":
      return withStudio(state, { mock: action.payload.value });
    case "set_config": {
      const next = { ...state.studio };
      let changed = false;
      for (const [k, v] of Object.entries(action.payload.patch)) {
        if (v === undefined) continue;
        if ((next as Record<string, unknown>)[k] !== v) {
          (next as Record<string, unknown>)[k] = v;
          changed = true;
        }
      }
      return changed ? { ...state, studio: next } : state;
    }
  }
}

function withStudio(state: State, patch: Partial<StudioSlice>): State {
  return { ...state, studio: { ...state.studio, ...patch } };
}

export const studioDriver: Driver<StudioAction> = {
  id: "studio",
  initialSlice: () => ({ ...DEFAULT_STUDIO, editor: { args: {} } }),
  apply,
  // Studio shell is fully deterministic on replay (engine drives every
  // studio action), so there are no paths to ignore in diff.
  volatilePaths: () => [],
};

// ── runtime ──────────────────────────────────────────────────────────────
// Phase 5: live dispatch. The runtime caller wires these to the studio
// store's setters; tests pass simple fakes.

export interface StudioRuntimeDeps {
  select(selection: { type: "tool" | "resource"; name: string } | null): void;
  setArgs(value: unknown): void;
  setConfig(patch: Partial<import("../types").StudioConfig>): void;
  setMock(value: unknown): void;
}

export function studioDispatch(
  deps: StudioRuntimeDeps,
): (action: StudioAction) => Promise<void> {
  return async (action) => {
    switch (action.kind) {
      case "select":
        deps.select(action.payload.selection);
        return;
      case "set_args":
        deps.setArgs(action.payload.value);
        return;
      case "set_config":
        deps.setConfig(action.payload.patch);
        return;
      case "set_mock":
        deps.setMock(action.payload.value);
        return;
    }
  };
}
