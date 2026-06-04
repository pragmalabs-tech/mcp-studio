import { create } from "zustand";
import {
  getBaseUrl,
  readResource,
  listTools,
  listResources,
  mcpInitialize,
  type McpToolInfo,
  type McpResourceInfo,
} from "../api";
import { DEFAULT_MOCK, type MockData } from "../mock-openai";
import { type ResultIssue } from "../validate-tool-result";
import { ToolCallAction, ResourceReadAction, type Action } from "@/lib/action";
import { resolveWidgetUri as resolveWidgetUriHelper } from "@/lib/action/widget-helpers";
import { migrateLocalStorageToBackend } from "../storage-migration";
import { createClaudeMock } from "../mock-claude";
import { recorder } from "../../recorder/recorder";
import { eventBus } from "@/lib/event";
import type { WidgetClickAction } from "@/lib/action/widget_click";
import type { WidgetTextInputAction } from "@/lib/action/widget_text_input";
import { renderHtml } from "@/lib/core/widget/render-html";
import { analyze } from "@/lib/core/csp/analyze";
import { stripTunnelUrls } from "@/lib/core/widget/inject";
import { useTestStore } from "./test-store";
import type {
  Platform,
  ViewportPreset,
  ViewportSize,
  SelectedItem,
  ActionEntry,
  ConsoleLevel,
  ConsoleEntry,
  PendingMessage,
  Widget,
  CspViolation,
} from "./types";

export { VIEWPORT_PRESETS } from "./types";
export type {
  Platform,
  ViewportPreset,
  ViewportSize,
  SelectedItem,
  ActionEntry,
  ConsoleLevel,
  ConsoleEntry,
  PendingMessage,
  Widget,
  CspViolation,
};

/** Resolvers parked by `insertWidget` and fulfilled by `setSnapshot`. */
const _pendingSnapshots = new Map<string, (snap: string | null) => void>();

function closeOpenClick(): void {
  const open = useWidgetStore.getState().openClick;
  if (open) open.close();
}

function closeOpenTextInput(): void {
  const open = useWidgetStore.getState().openTextInput;
  if (open) open.close();
}

function defaultEditorValue() {
  return JSON.stringify(
    {
      toolInput: DEFAULT_MOCK.toolInput,
      toolOutput: DEFAULT_MOCK.toolOutput,
      _meta: DEFAULT_MOCK._meta,
      widgetState: DEFAULT_MOCK.widgetState,
    },
    null,
    2,
  );
}

interface JsonSchemaProperty {
  type?: string;
  default?: unknown;
  examples?: unknown[];
  example?: unknown;
  enum?: unknown[];
  description?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  format?: string;
}

function sampleValue(key: string, prop: JsonSchemaProperty): unknown {
  if (prop.default !== undefined) return prop.default;
  if (prop.examples?.length) return prop.examples[0];
  if (prop.example !== undefined) return prop.example;
  if (prop.enum?.length) return prop.enum[0];

  if (prop.format === "date") return "2026-01-15";
  if (prop.format === "date-time") return "2026-01-15T10:30:00Z";
  if (prop.format === "email") return "user@example.com";
  if (prop.format === "uri" || prop.format === "url")
    return "https://example.com";
  if (prop.format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";

  if (prop.type === "string") {
    const k = key.toLowerCase();
    if (k.includes("name")) return "example";
    if (k.includes("id")) return "abc-123";
    if (k.includes("email")) return "user@example.com";
    if (k.includes("url") || k.includes("uri")) return "https://example.com";
    if (k.includes("lang") || k.includes("locale")) return "en-US";
    if (k.includes("query") || k.includes("search") || k.includes("question"))
      return "sample query";
    if (k.includes("message") || k.includes("text") || k.includes("content"))
      return "Hello world";
    if (k.includes("description")) return "A sample description";
    if (k.includes("title")) return "Sample Title";
    if (prop.description) return `<${prop.description}>`;
    return "example";
  }
  if (prop.type === "number" || prop.type === "integer") {
    if (prop.minimum !== undefined) return prop.minimum;
    if (prop.maximum !== undefined) return Math.min(prop.maximum, 10);
    return prop.type === "integer" ? 1 : 1.0;
  }
  if (prop.type === "boolean") return true;
  if (prop.type === "array") {
    if (prop.items) return [sampleValue("item", prop.items)];
    return [];
  }
  if (prop.type === "object") {
    if (prop.properties)
      return sampleFromProperties(prop.properties, prop.required);
    return {};
  }
  return null;
}

function sampleFromProperties(
  properties: Record<string, JsonSchemaProperty>,
  required?: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    result[key] = sampleValue(key, prop);
  }
  if (required?.length) {
    const ordered: Record<string, unknown> = {};
    for (const key of required) {
      if (key in result) ordered[key] = result[key];
    }
    for (const key of Object.keys(result)) {
      if (!(key in ordered)) ordered[key] = result[key];
    }
    return ordered;
  }
  return result;
}

function toolArgsFromSchema(schema?: Record<string, unknown>): string {
  if (!schema || !schema.properties) return "{}";
  const props = schema.properties as Record<string, JsonSchemaProperty>;
  const required = schema.required as string[] | undefined;
  return JSON.stringify(sampleFromProperties(props, required), null, 2);
}

function formatTimestamp(): string {
  const now = new Date();
  return (
    now.toTimeString().split(" ")[0] +
    "." +
    String(now.getMilliseconds()).padStart(3, "0")
  );
}

function reInjectAll(
  get: () => WidgetState,
  set: (partial: Partial<WidgetState>) => void,
): void {
  const { widgets, platform, strictMode } = get();
  if (!Object.keys(widgets).length) return;
  const updated = Object.fromEntries(
    Object.entries(widgets).map(([id, entry]) => {
      const { html: injectedHtml } = renderHtml({
        html: entry.originalHtml,
        mock: entry.mock,
        platform,
        strict: strictMode,
      });
      return [id, { ...entry, injectedHtml, snapshot: null }];
    }),
  );
  set({ widgets: updated });
}

interface WidgetState {
  // Tools & resources (loaded by loadAll)
  tools: McpToolInfo[];
  resources: McpResourceInfo[];
  loading: boolean;
  loadingStatus: string | null;
  mcpError: string | null;

  // Auth panel visibility (set open on connection errors)
  authOpen: boolean;

  // Widget config
  platform: Platform;
  theme: string;
  locale: string;
  displayMode: string;
  viewportPreset: ViewportPreset;
  viewportCustom: ViewportSize;

  // Selection & editor
  selected: SelectedItem | null;
  editorValue: string;
  studioTheme: "light" | "dark";

  // Execution
  toolExecuting: boolean;
  jsonOutput: string | null;
  lastResult: unknown | null;
  resultIssues: ResultIssue[];
  actions: ActionEntry[];
  consoleEntries: ConsoleEntry[];
  pendingMessages: PendingMessage[];

  // CSP / Strict mode
  strictMode: boolean;
  cspViolations: CspViolation[];

  // Widget registry
  widgetCache: Record<string, string>;
  widgets: Record<string, Widget>;
  activeWidgetId: string | null;
  autoHeight: number | null;

  // Protocol detection
  detectedProtocols: { legacyOpenAI: boolean; extApps: boolean } | null;

  // Refs (transient, never persisted)
  _iframeRef: HTMLIFrameElement | null;
  _extAppsMock: ReturnType<typeof createClaudeMock> | null;
  openClick: WidgetClickAction | null;
  openTextInput: WidgetTextInputAction | null;

  // Actions
  loadAll: () => Promise<void>;
  setAuthOpen: (open: boolean) => void;
  select: (item: SelectedItem) => void;
  setEditorValue: (value: string) => void;
  setStudioTheme: (t: "light" | "dark") => void;
  setPlatform: (p: Platform) => void;
  setTheme: (t: string) => void;
  setLocale: (l: string) => void;
  setDisplayMode: (d: string) => void;
  setViewportPreset: (p: ViewportPreset) => void;
  setViewportCustom: (size: Partial<ViewportSize>) => void;
  getViewportSize: () => ViewportSize;
  logAction: (method: string, args: unknown) => void;
  clearActions: () => void;
  addConsoleEntry: (level: ConsoleLevel, args: string[]) => void;
  clearConsoleEntries: () => void;
  addPendingMessage: (source: "openai" | "claude", content: unknown) => void;
  dismissMessage: (id: string) => void;
  clearMessages: () => void;
  setIframeRef: (el: HTMLIFrameElement | null) => void;
  setStrictMode: (on: boolean) => void;
  addCspViolation: (v: CspViolation) => void;
  clearCspViolations: () => void;
  setProtocolDetected: (protocol: "legacy_openai" | "ext_apps") => void;
  setAutoHeight: (h: number | null) => void;
  insertWidget: (
    id: string,
    entry: Omit<Widget, "id" | "snapshot" | "injectedHtml">,
  ) => Promise<string | null>;
  setSnapshot: (id: string, snapshot: string) => void;
  loadWidget: () => Promise<void>;
  applyMock: () => void;
  injectMockData: (mockJson: string) => void;
  reloadWidget: () => Promise<void>;
  execute: () => Promise<void>;
}

export const useWidgetStore = create<WidgetState>((set, get) => ({
  tools: [],
  resources: [],
  loading: true,
  loadingStatus: null,
  mcpError: null,

  authOpen: false,

  platform: "openai",
  theme: "dark",
  locale: "en-US",
  displayMode: "inline",
  viewportPreset: "desktop" as ViewportPreset,
  viewportCustom: { width: 430, height: 932 },

  selected: null,
  editorValue: defaultEditorValue(),
  studioTheme: (() => {
    document.documentElement.classList.add("dark");
    return "dark" as "light" | "dark";
  })(),

  toolExecuting: false,
  jsonOutput: null,
  lastResult: null,
  resultIssues: [],
  actions: [],
  consoleEntries: [],
  pendingMessages: [],

  strictMode: false,
  cspViolations: [],

  widgetCache: {},
  widgets: {},
  activeWidgetId: null,
  autoHeight: null,

  detectedProtocols: null,

  _iframeRef: null as HTMLIFrameElement | null,
  _extAppsMock: null,
  openClick: null as WidgetClickAction | null,
  openTextInput: null as WidgetTextInputAction | null,

  // ── Actions ──

  loadAll: async () => {
    set({
      loading: true,
      loadingStatus: "Initializing session…",
      mcpError: null,
    });

    try {
      await mcpInitialize();
    } catch (e) {
      const msg = (e as Error).message || "Session initialization failed";
      set({
        loading: false,
        loadingStatus: null,
        mcpError: `Session: ${msg}`,
        authOpen: true,
      });
      return;
    }

    set({ loadingStatus: "Fetching tools & resources…" });
    const [toolsResult, resourcesResult] = await Promise.allSettled([
      listTools(),
      listResources(),
    ]);

    const t = toolsResult.status === "fulfilled" ? toolsResult.value : [];
    const r =
      resourcesResult.status === "fulfilled" ? resourcesResult.value : [];

    const errors: string[] = [];
    if (toolsResult.status === "rejected")
      errors.push(`Tools: ${toolsResult.reason?.message || "failed"}`);
    if (resourcesResult.status === "rejected")
      errors.push(`Resources: ${resourcesResult.reason?.message || "failed"}`);
    const mcpError = errors.length > 0 ? errors.join("\n") : null;

    if (mcpError) set({ authOpen: true });

    set({
      tools: t.sort((a, b) => a.name.localeCompare(b.name)),
      resources: r.sort((a, b) =>
        (a.name || a.uri).localeCompare(b.name || b.uri),
      ),
      loading: false,
      loadingStatus: null,
      mcpError,
      widgetCache: {},
    });

    const widgetUris = r
      .filter(
        (res) =>
          res.uri.startsWith("ui://") &&
          res.mimeType === "text/html;profile=mcp-app",
      )
      .map((res) => res.uri);
    if (widgetUris.length > 0) {
      const settled = await Promise.allSettled(
        widgetUris.map((uri) => readResource(uri)),
      );
      const cache: Record<string, string> = {};
      for (let i = 0; i < widgetUris.length; i++) {
        const res = settled[i];
        if (res.status !== "fulfilled") continue;
        const result = res.value as { contents?: { text?: string }[] };
        const html = result?.contents?.[0]?.text ?? "";
        if (html) cache[widgetUris[i]] = html;
      }
      set({ widgetCache: cache });
    }

    const { selected } = get();
    if (!selected) {
      if (t.length > 0) get().select({ type: "tool", tool: t[0] });
      else if (r.length > 0) get().select({ type: "resource", resource: r[0] });
    }

    void migrateLocalStorageToBackend();
  },

  setAuthOpen: (open) => set({ authOpen: open }),

  select: (item) => {
    get()._extAppsMock?.destroy();
    set({
      selected: item,
      actions: [],
      consoleEntries: [],
      pendingMessages: [],
      jsonOutput: null,
      lastResult: null,
      resultIssues: [],
      _extAppsMock: null,
      activeWidgetId: null,
    });

    if (item.type === "tool") {
      set({ editorValue: toolArgsFromSchema(item.tool.inputSchema) });
    } else if (item.type === "resource") {
      set({ editorValue: JSON.stringify({ uri: item.resource.uri }, null, 2) });
    }

    const meta =
      item.type === "tool"
        ? (item.tool.meta as Record<string, unknown> | undefined)
        : undefined;
    const toolName = item.type === "tool" ? item.tool.name : null;
    if (
      resolveWidgetUriHelper(meta, toolName, get().resources) &&
      useTestStore.getState().studioMode !== "test"
    ) {
      setTimeout(() => get().loadWidget(), 50);
    }
  },

  setEditorValue: (value) => set({ editorValue: value }),

  setStudioTheme: (t) => {
    set({ studioTheme: t });
    document.documentElement.classList.toggle("dark", t === "dark");
  },

  setPlatform: (p) => {
    set({ platform: p });
    if (useTestStore.getState().studioMode !== "test") {
      reInjectAll(get, set);
    }
  },

  setTheme: (t) => {
    set({ theme: t });
    if (useTestStore.getState().studioMode !== "test") {
      setTimeout(() => get().applyMock(), 50);
    }
  },

  setLocale: (l) => {
    set({ locale: l });
    if (useTestStore.getState().studioMode !== "test") {
      setTimeout(() => get().applyMock(), 50);
    }
  },

  setDisplayMode: (d) => {
    set({ displayMode: d });
    if (useTestStore.getState().studioMode !== "test") {
      setTimeout(() => get().applyMock(), 50);
    }
  },

  setViewportPreset: (p) => set({ viewportPreset: p }),

  setViewportCustom: (size) => {
    set((s) => ({ viewportCustom: { ...s.viewportCustom, ...size } }));
  },

  getViewportSize: () => {
    const { viewportPreset, viewportCustom } = get();
    if (viewportPreset === "custom") return viewportCustom;
    return (
      (
        {
          desktop: { width: 1280, height: 800 },
          tablet: { width: 820, height: 1180 },
          mobile: { width: 430, height: 932 },
        } as Record<string, ViewportSize>
      )[viewportPreset] ?? viewportCustom
    );
  },

  logAction: (method, args) => {
    const argsStr = typeof args === "string" ? args : JSON.stringify(args);
    set((s) => ({
      actions: [
        ...s.actions,
        { time: formatTimestamp(), method, args: argsStr },
      ],
    }));
  },

  clearActions: () => set({ actions: [] }),

  addConsoleEntry: (level, args) =>
    set((s) => ({
      consoleEntries: [
        ...s.consoleEntries,
        { time: formatTimestamp(), level, args },
      ],
    })),

  clearConsoleEntries: () => set({ consoleEntries: [] }),

  addPendingMessage: (source, content) => {
    const msg: PendingMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: formatTimestamp(),
      source,
      content,
    };
    set((s) => ({ pendingMessages: [...s.pendingMessages, msg] }));
  },

  dismissMessage: (id) => {
    set((s) => ({
      pendingMessages: s.pendingMessages.filter((m) => m.id !== id),
    }));
  },

  clearMessages: () => set({ pendingMessages: [] }),

  setIframeRef: (el) => set({ _iframeRef: el }),

  setStrictMode: (on) => {
    set({ strictMode: on, cspViolations: [] });
    if (useTestStore.getState().studioMode !== "test") {
      reInjectAll(get, set);
    }
  },

  addCspViolation: (v) => {
    set((s) => {
      const isDupe = s.cspViolations.some(
        (existing) =>
          existing.directive === v.directive &&
          existing.blockedUri === v.blockedUri,
      );
      if (isDupe) return s;
      return { cspViolations: [...s.cspViolations, v] };
    });
  },

  clearCspViolations: () => set({ cspViolations: [] }),

  setProtocolDetected: (protocol) =>
    set((s) => {
      const prev = s.detectedProtocols ?? {
        legacyOpenAI: false,
        extApps: false,
      };
      return {
        detectedProtocols:
          protocol === "legacy_openai"
            ? { ...prev, legacyOpenAI: true }
            : { ...prev, extApps: true },
      };
    }),

  setAutoHeight: (h) => set({ autoHeight: h }),

  insertWidget: (id, entry) => {
    const prior = _pendingSnapshots.get(id);
    if (prior) {
      prior(null);
      _pendingSnapshots.delete(id);
    }

    const ready = new Promise<string | null>((resolve) => {
      _pendingSnapshots.set(id, resolve);
    });

    const { platform, strictMode, addCspViolation } = get();
    const { html: injectedHtml, cspDomains } = renderHtml({
      html: entry.originalHtml,
      mock: entry.mock,
      platform,
      strict: strictMode,
    });

    const { findings } = analyze(
      stripTunnelUrls(entry.originalHtml),
      cspDomains,
    );
    for (const finding of findings) {
      addCspViolation({
        id: `static_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: new Date().toTimeString().split(" ")[0],
        directive: finding.directive,
        blockedUri: finding.blocked,
        sourceFile: id,
        lineNumber: finding.line || 0,
        columnNumber: 0,
        source: "static" as const,
        fix: finding.fix,
        severity: finding.severity,
        platforms: finding.platforms,
        snippet: finding.snippet,
      });
    }

    set((s) => ({
      widgets: {
        ...s.widgets,
        [id]: { ...entry, id, injectedHtml, snapshot: null },
      },
      activeWidgetId: id,
      autoHeight: null,
    }));

    return ready;
  },

  setSnapshot: (id, snapshot) => {
    set((s) => {
      const existing = s.widgets[id];
      if (!existing) return s;
      return {
        widgets: { ...s.widgets, [id]: { ...existing, snapshot } },
      };
    });
    const resolve = _pendingSnapshots.get(id);
    if (resolve) {
      resolve(snapshot);
      _pendingSnapshots.delete(id);
    }
  },

  loadWidget: async () => {
    const {
      editorValue,
      theme,
      locale,
      displayMode,
      logAction,
      resources,
      widgetCache,
      selected,
    } = get();
    const meta =
      selected?.type === "tool"
        ? (selected.tool.meta as Record<string, unknown> | undefined)
        : undefined;
    const toolName = selected?.type === "tool" ? selected.tool.name : null;
    const widgetUri = resolveWidgetUriHelper(meta, toolName, resources);
    if (!widgetUri) return;

    let html = widgetCache[widgetUri] ?? "";
    if (!html) {
      try {
        const res = (await readResource(widgetUri)) as {
          contents?: { text?: string }[];
        };
        html = res?.contents?.[0]?.text ?? "";
        if (html) {
          set((s) => ({
            widgetCache: { ...s.widgetCache, [widgetUri]: html },
          }));
        }
      } catch (e) {
        logAction("error", `Widget HTML fetch failed: ${(e as Error).message}`);
        return;
      }
    }
    if (!html.trim()) return;

    try {
      const parsed = JSON.parse(editorValue);
      const mock: MockData = {
        toolInput: parsed.toolInput || {},
        toolOutput: parsed.toolOutput || {},
        _meta: parsed._meta || {},
        widgetState: parsed.widgetState || null,
        theme,
        locale,
        displayMode,
      };
      get().insertWidget(widgetUri, { originalHtml: html, mock, waitMs: 150 });
    } catch (e) {
      logAction("error", `Invalid JSON: ${(e as Error).message}`);
    }
  },

  applyMock: () => {
    const {
      _iframeRef: iframe,
      platform,
      editorValue,
      theme,
      locale,
      displayMode,
      logAction,
      activeWidgetId,
      widgets,
    } = get();
    if (!activeWidgetId || !widgets[activeWidgetId]) return;

    try {
      const parsed = JSON.parse(editorValue);
      const mock: MockData = {
        toolInput: parsed.toolInput || {},
        toolOutput: parsed.toolOutput || {},
        _meta: parsed._meta || {},
        widgetState: parsed.widgetState || null,
        theme,
        locale,
        displayMode,
      };

      set((s) => ({
        widgets: {
          ...s.widgets,
          [activeWidgetId]: { ...s.widgets[activeWidgetId], mock },
        },
      }));

      if (platform === "openai" && iframe) {
        try {
          const win = iframe.contentWindow;
          if (win && (win as unknown as { openai: unknown }).openai) {
            const openai = (
              win as unknown as { openai: Record<string, unknown> }
            ).openai;
            openai.toolInput = mock.toolInput;
            openai.toolOutput = mock.toolOutput;
            openai.toolResponseMetadata = mock._meta;
            openai.widgetState = mock.widgetState;
            openai.theme = mock.theme;
            openai.locale = mock.locale;
            openai.displayMode = mock.displayMode;
            win.dispatchEvent(new CustomEvent("openai:set_globals"));
            get()._extAppsMock?.update(mock);
            logAction("system", "Mock data applied");
            return;
          }
        } catch {
          /* fall through */
        }
      }

      if (platform === "claude") {
        get()._extAppsMock?.update(mock);
        logAction("system", "Mock data applied");
        return;
      }

      // OpenAI ext-apps protocol (no legacy window.openai globals) — update in-place.
      if (get()._extAppsMock) {
        get()._extAppsMock?.update(mock);
        logAction("system", "Mock data applied");
        return;
      }

      set((s) => ({
        widgets: {
          ...s.widgets,
          [activeWidgetId]: { ...s.widgets[activeWidgetId], snapshot: null },
        },
      }));
      logAction("system", "Mock data applied (reload)");
    } catch (e) {
      logAction("error", `Invalid JSON: ${(e as Error).message}`);
    }
  },

  injectMockData: (mockJson) => {
    const { theme, locale, displayMode, activeWidgetId, widgets, logAction } =
      get();
    if (!activeWidgetId || !widgets[activeWidgetId]) return;
    try {
      const parsed = JSON.parse(mockJson);
      const mock: import("../mock-openai").MockData = {
        toolInput: parsed.toolInput ?? {},
        toolOutput: parsed.toolOutput ?? {},
        _meta: parsed._meta ?? {},
        widgetState: parsed.widgetState ?? null,
        theme,
        locale,
        displayMode,
      };
      set((s) => ({
        widgets: {
          ...s.widgets,
          [activeWidgetId]: { ...s.widgets[activeWidgetId], mock },
        },
      }));
      get()._extAppsMock?.update(mock);
      logAction("system", "Mock data injected");
    } catch (e) {
      logAction("error", `Invalid JSON: ${(e as Error).message}`);
    }
  },

  reloadWidget: async () => {
    const { activeWidgetId, widgets, theme, locale, displayMode, logAction } =
      get();
    if (!activeWidgetId) return;

    // Clear cached HTML so the next fetch is fresh
    set((s) => ({
      widgetCache: { ...s.widgetCache, [activeWidgetId]: "" },
    }));

    logAction("system", `Reloading widget ${activeWidgetId}…`);
    try {
      const res = (await readResource(activeWidgetId)) as {
        contents?: { text?: string }[];
      };
      const html = res?.contents?.[0]?.text ?? "";
      if (!html.trim()) {
        logAction("error", "Reload failed: empty HTML response");
        return;
      }
      set((s) => ({
        widgetCache: { ...s.widgetCache, [activeWidgetId]: html },
      }));
      // Preserve the current mock data so injected test data survives the reload
      const currentMock = widgets[activeWidgetId]?.mock ?? {
        toolInput: {},
        toolOutput: {},
        _meta: {},
        widgetState: null,
        theme,
        locale,
        displayMode,
      };
      get().insertWidget(activeWidgetId, {
        originalHtml: html,
        mock: currentMock,
        waitMs: 0,
      });
      logAction("system", "Widget reloaded");
    } catch (e) {
      logAction("error", `Reload failed: ${(e as Error).message}`);
    }
  },

  execute: async () => {
    closeOpenClick();
    closeOpenTextInput();
    if (get().toolExecuting) return;
    const { selected } = get();
    if (!selected || selected.type === "widget") return;

    set({ toolExecuting: true, resultIssues: [] });
    try {
      const action =
        selected.type === "tool"
          ? new ToolCallAction(
              selected.tool.name,
              JSON.parse(get().editorValue),
            )
          : new ResourceReadAction(selected.resource.uri);
      eventBus.setActive(action);
      try {
        await action.execute();
      } finally {
        eventBus.setActive(null);
      }
      recorder.record(action, { stateChange: action.change() });
    } finally {
      set({ toolExecuting: false });
    }
  },
}));

if (typeof window !== "undefined") {
  const s = useWidgetStore.getState();
  recorder.start({
    url: getBaseUrl(),
    theme: s.theme,
    locale: s.locale,
  });
}

// On OFFLINE → ONLINE transition, clear stale mcpError and reload tools/resources.
// Wired here (not in health.ts) to avoid a circular import through api.ts.
import("../health").then(({ useHealthStore }) => {
  const isOffline = (s: string) => s === "disconnected" || s === "unauthorized";
  let prevStatus = useHealthStore.getState().status;
  useHealthStore.subscribe((state) => {
    if (state.status === "connected" && isOffline(prevStatus)) {
      const ws = useWidgetStore.getState();
      if (ws.mcpError) useWidgetStore.setState({ mcpError: null });
      if (!ws.loading) ws.loadAll();
    }
    prevStatus = state.status;
  });
});
