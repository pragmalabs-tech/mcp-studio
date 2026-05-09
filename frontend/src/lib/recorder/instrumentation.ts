import { recorder } from "./bus";
import { registerPreRequestFlush } from "./mcp-interceptor";
import type {
  AuthBlock,
  Action,
  SetupConfig,
  SetupConnect,
  Viewport,
} from "./schema";

/**
 * Minimal slice of the Studio store the recorder watches. Defined here (not
 * imported) so this module compiles without circular deps and stays testable
 * with synthetic state objects.
 */
export interface RecordableState {
  proxyUrl: string;
  authMethod: "oauth" | "bearer" | "custom";
  token: string;
  oauth: {
    accessToken: string | null;
    selectedScopes: string[];
    customHeaders: string;
  };
  platform: "openai" | "claude";
  theme: string;
  displayMode: string;
  locale: string;
  viewportPreset: string;
  viewportCustom: { width: number; height: number };
  strictMode: boolean;
  selected:
    | { type: "tool"; tool: { name: string } }
    | { type: "resource"; resource: { uri: string; name?: string } }
    | { type: "widget"; name: string }
    | null;
  editorValue: string;
  /** "test" while the Player is replaying — instrumentation pauses to avoid
   *  re-capturing player-driven setters into the live timeline. */
  studioMode?: "normal" | "test";
}

const EDITOR_DEBOUNCE_MS = 300;

function viewportFrom(state: RecordableState): Viewport {
  if (state.viewportPreset === "custom") {
    return {
      width: state.viewportCustom.width,
      height: state.viewportCustom.height,
    };
  }
  return { preset: state.viewportPreset };
}

function configFrom(state: RecordableState): SetupConfig {
  return {
    platform: state.platform,
    theme: state.theme,
    displayMode: state.displayMode,
    locale: state.locale,
    viewport: viewportFrom(state),
    strictMode: state.strictMode,
  };
}

function customHeadersFrom(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function authFrom(state: RecordableState): AuthBlock {
  switch (state.authMethod) {
    case "oauth":
      return { method: "oauth", token: state.oauth.accessToken ?? "" };
    case "bearer":
      return { method: "bearer", token: state.token ?? "" };
    case "custom":
      return {
        method: "custom",
        headers: customHeadersFrom(state.oauth.customHeaders),
      };
  }
}

export function snapshotSetup(state: RecordableState): {
  connect: SetupConnect;
  config: SetupConfig;
} {
  return {
    connect: { url: state.proxyUrl, auth: authFrom(state) },
    config: configFrom(state),
  };
}

function diffViewport(prev: Viewport, next: Viewport): boolean {
  if ("preset" in prev && "preset" in next) return prev.preset !== next.preset;
  if ("width" in prev && "width" in next)
    return prev.width !== next.width || prev.height !== next.height;
  return true;
}

function diffConfig(
  prev: SetupConfig,
  next: SetupConfig,
): Partial<SetupConfig> | null {
  const patch: Partial<SetupConfig> = {};
  if (prev.platform !== next.platform) patch.platform = next.platform;
  if (prev.theme !== next.theme) patch.theme = next.theme;
  if (prev.displayMode !== next.displayMode)
    patch.displayMode = next.displayMode;
  if (prev.locale !== next.locale) patch.locale = next.locale;
  if (diffViewport(prev.viewport, next.viewport))
    patch.viewport = next.viewport;
  if (prev.strictMode !== next.strictMode) patch.strictMode = next.strictMode;
  return Object.keys(patch).length ? patch : null;
}

function diffAuth(prev: AuthBlock, next: AuthBlock): Partial<AuthBlock> | null {
  if (prev.method !== next.method) return next;
  if (prev.method === "custom" && next.method === "custom") {
    if (JSON.stringify(prev.headers) !== JSON.stringify(next.headers)) {
      return { method: "custom", headers: next.headers };
    }
    return null;
  }
  if (
    (prev.method === "oauth" || prev.method === "bearer") &&
    prev.method === next.method
  ) {
    if (prev.token !== (next as { token: string }).token) {
      return { method: prev.method, token: (next as { token: string }).token };
    }
  }
  return null;
}

function selectionFrom(
  selected: RecordableState["selected"],
): { type: "tool" | "resource"; name: string } | null {
  if (!selected) return null;
  if (selected.type === "tool")
    return { type: "tool", name: selected.tool.name };
  if (selected.type === "resource") {
    return {
      type: "resource",
      name: selected.resource.name ?? selected.resource.uri,
    };
  }
  return null;
}

/**
 * Subscribe a Zustand-style store to the recorder bus. The subscriber walks the
 * whitelisted state paths on each update, debounces editor changes, and emits
 * the typed Action equivalents.
 *
 * Returns the unsubscribe function and a manual flush hook (for testing).
 */
export function attachInstrumentation<T extends RecordableState>(
  store: {
    getState: () => T;
    subscribe: (listener: (state: T, prev: T) => void) => () => void;
  },
  emit: (action: Action) => void = (a) => recorder.emit(a),
): { detach: () => void; flushEditor: () => void } {
  let editorTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingEditorValue: string | null = null;

  function flushEditor() {
    if (editorTimer) {
      clearTimeout(editorTimer);
      editorTimer = null;
    }
    if (pendingEditorValue !== null) {
      const raw = pendingEditorValue;
      pendingEditorValue = null;
      let value: unknown = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      emit({ kind: "editor.set_args", value });
    }
  }

  const unregisterFlush = registerPreRequestFlush(flushEditor);

  const unsubscribe = store.subscribe((state, prev) => {
    if (recorder.mode !== "recording") return;
    // While the Player drives the store, suppress emission so player-driven
    // setters don't pollute the live timeline with synthetic actions.
    if (state.studioMode === "test") return;

    const cfgPatch = diffConfig(configFrom(prev), configFrom(state));
    if (cfgPatch) emit({ kind: "config.update", patch: cfgPatch });

    const authPatch = diffAuth(authFrom(prev), authFrom(state));
    if (authPatch) emit({ kind: "auth.update", patch: authPatch });

    if (prev.selected !== state.selected) {
      const sel = selectionFrom(state.selected);
      if (sel) emit({ kind: "sidebar.select", selection: sel });
    }

    if (prev.editorValue !== state.editorValue) {
      pendingEditorValue = state.editorValue;
      if (editorTimer) clearTimeout(editorTimer);
      editorTimer = setTimeout(flushEditor, EDITOR_DEBOUNCE_MS);
    }
  });

  return {
    detach: () => {
      unsubscribe();
      unregisterFlush();
      if (editorTimer) clearTimeout(editorTimer);
    },
    flushEditor,
  };
}
