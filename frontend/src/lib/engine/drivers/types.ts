import type { Action, ActionKind, Recorded } from "@/lib/recorder/schema";
import type { BridgeClient } from "@/lib/engine/bridge-client";

/** Minimal store API the Player needs. Concrete provider lives in store.ts. */
export interface EngineStore {
  setStudioMode(mode: "normal" | "test"): void;
  setStrictMode(on: boolean): void;
  setProxyUrl(url: string): void;
  getProxyUrl(): string;
  setAuthMethod(method: "oauth" | "bearer" | "custom"): void;
  setToken(draft: string): void;
  saveToken(): void;
  setOAuthCustomHeaders(headers: string): void;
  setPlatform(platform: "openai" | "claude"): void;
  setTheme(theme: string): void;
  setLocale(locale: string): void;
  setDisplayMode(mode: string): void;
  setViewportPreset(preset: string): void;
  setViewportCustom(size: { width?: number; height?: number }): void;
  setEditorValue(value: string): void;
  select(item: unknown): void;
  loadAll(): Promise<void>;
  loadWidget(): Promise<void>;
  applyMock(): void;
  execute(): Promise<void>;
  /** Read-only access to current state for assertions / preconditions. */
  getState(): {
    strictMode: boolean;
    /** `meta` carries the tool's `_meta` (normalized to `meta` by the studio
     *  loader). Used by `cue.widget_open` to verify the tool declares a
     *  widget reference before executing. */
    tools: { name: string; meta?: Record<string, unknown> }[];
    resources: { uri: string; name?: string }[];
    selected: unknown;
    /** Last MCP response observed by `execute()`. Used by `cue.widget_open`
     *  to feed the rendered tool's response into the assertion bundle. */
    lastResult: unknown;
  };
}

export interface DriverContext {
  store: EngineStore;
  iframe: () => HTMLIFrameElement | null;
  bridge: BridgeClient;
  signal: AbortSignal;
  /** Hook for `mcp.response` / `widget.render.complete` observations.
   *  The Player resolves observation promises by listening on the bus. */
  onObservation: (
    predicate: (entry: Recorded) => boolean,
    timeoutMs: number,
  ) => Promise<Recorded | null>;
}

export type DriveOutcome =
  | { ok: true; observation?: unknown; durationMs: number }
  | { ok: false; reason: string; durationMs: number };

export interface Driver<A extends Action = Action> {
  /** Action kinds this driver handles. */
  readonly kinds: readonly ActionKind[];
  drive(action: A, ctx: DriverContext): Promise<DriveOutcome>;
}
