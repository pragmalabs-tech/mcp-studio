/**
 * Wires the studio's live deps (zustand store, recorder bus, MCP client,
 * iframe bridge) into a Driver[] the engine can run.
 *
 * Lives in core/ but imports from outside core/ — this is the single
 * "glue" boundary. Tests for engine/drivers don't go through here; they
 * pass fakes via `EngineDeps.drivers`.
 */

import { recorder } from "@/lib/recorder/bus";
import type { Recorded, SelectorChain } from "@/lib/recorder/schema";
import { mcpCall } from "@/lib/studio/api";
import { useStudioStore } from "@/lib/studio/store";
import { studioDispatch, studioDriver } from "./drivers/studio";
import {
  type BusEntry,
  mcpAttach,
  mcpDispatch,
  mcpDriver,
} from "./drivers/mcp";
import { widgetAttach, widgetDispatch, widgetDriver } from "./drivers/widget";
import type { Driver, StudioConfig } from "./types";

export interface RuntimeBridge {
  dispatch(
    selectors: SelectorChain,
    kind: string,
    extra?: unknown,
  ): Promise<void>;
}

/** Build the runtime driver list. Call once per engine.run; the
 *  returned drivers carry closed-over deps. */
export function buildRuntimeDrivers(bridge: RuntimeBridge): Driver[] {
  const onBusEmit = (h: (e: BusEntry) => void): (() => void) =>
    recorder.onEmit((entry: Recorded) => h(entry as unknown as BusEntry));

  const studio: Driver = {
    ...studioDriver,
    dispatch: studioDispatch({
      select: (sel) => {
        const s = useStudioStore.getState();
        if (sel === null) return; // store has no clear-select; no-op
        const tools = s.tools;
        const resources = s.resources;
        if (sel.type === "tool") {
          const t = tools.find((x) => x.name === sel.name);
          if (t) s.select({ type: "tool", tool: t });
        } else {
          const r = resources.find((x) => x.uri === sel.name);
          if (r) s.select({ type: "resource", resource: r });
        }
      },
      setArgs: (v) =>
        useStudioStore.getState().setEditorValue(JSON.stringify(v, null, 2)),
      setConfig: (patch) => applyConfigPatch(patch),
      setMock: (_v) => {
        // Mock fixture: no direct setter on the store; recorder-driven only.
      },
    }) as Driver["dispatch"],
  };

  const mcp: Driver = {
    ...mcpDriver,
    dispatch: mcpDispatch({
      call: (method, params) => mcpCall(method, params),
      onBusEmit,
    }) as Driver["dispatch"],
    attach: mcpAttach({
      call: (m, p) => mcpCall(m, p),
      onBusEmit,
    }) as Driver["attach"],
  };

  const widget: Driver = {
    ...widgetDriver,
    dispatch: widgetDispatch({
      mount: async () => {
        await useStudioStore.getState().loadWidget();
      },
      bridge,
      onBusEmit,
    }) as Driver["dispatch"],
    attach: widgetAttach({
      mount: async () => undefined,
      bridge,
      onBusEmit,
    }) as Driver["attach"],
  };

  return [studio, mcp, widget];
}

/** Apply a studio.set_config patch to the studio store, mapping each
 *  patch key to its setter. */
function applyConfigPatch(patch: Partial<StudioConfig>): void {
  const s = useStudioStore.getState();
  if (patch.theme !== undefined) s.setTheme(patch.theme);
  if (patch.locale !== undefined) s.setLocale(patch.locale);
  if (patch.displayMode !== undefined) s.setDisplayMode(patch.displayMode);
  if (patch.strictMode !== undefined) s.setStrictMode(patch.strictMode);
  if (patch.viewport !== undefined) {
    if ("preset" in patch.viewport) {
      // The store's setViewportPreset takes a narrow ViewportPreset enum;
      // our schema-level type is the wider `string`. Cast at the boundary.
      s.setViewportPreset(patch.viewport.preset as never);
    } else {
      s.setViewportCustom(patch.viewport);
    }
  }
}
