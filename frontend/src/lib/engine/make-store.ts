import { useStudioStore } from "@/lib/studio/store";
import type { ViewportPreset, SelectedItem } from "@/lib/studio/store";
import type { EngineStore } from "./drivers/types";

/**
 * Adapter that exposes the StudioStore as the slimmer EngineStore interface
 * the drivers expect. Each setter and `getState()` reads the live store via
 * `useStudioStore.getState()` so changes always hit the current state.
 */
export function makeEngineStore(): EngineStore {
  const get = () => useStudioStore.getState();
  return {
    setStudioMode: (m) => get().setStudioMode(m),
    setStrictMode: (b) => get().setStrictMode(b),
    setProxyUrl: (u) => get().setProxyUrl(u),
    setAuthMethod: (m) => get().setAuthMethod(m),
    setToken: (t) => get().setToken(t),
    saveToken: () => get().saveToken(),
    setOAuthCustomHeaders: (h) => get().setOAuthCustomHeaders(h),
    setPlatform: (p) => get().setPlatform(p),
    setTheme: (t) => get().setTheme(t),
    setLocale: (l) => get().setLocale(l),
    setDisplayMode: (m) => get().setDisplayMode(m),
    setViewportPreset: (p) => get().setViewportPreset(p as ViewportPreset),
    setViewportCustom: (s) => get().setViewportCustom(s),
    setEditorValue: (v) => get().setEditorValue(v),
    select: (item) => get().select(item as SelectedItem),
    loadAll: () => get().loadAll(),
    loadWidget: () => get().loadWidget(),
    applyMock: () => get().applyMock(),
    execute: () => get().execute(),
    getState: () => {
      const s = get();
      return {
        strictMode: s.strictMode,
        tools: s.tools,
        resources: s.resources,
        selected: s.selected,
      };
    },
  };
}
