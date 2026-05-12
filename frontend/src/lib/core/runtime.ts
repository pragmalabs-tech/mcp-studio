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
import type { Driver, StudioConfig, WidgetMock } from "./types";

export interface RuntimeBridge {
  dispatch(
    selectors: SelectorChain,
    kind: string,
    extra?: unknown,
  ): Promise<void>;
  /** Resolve when the iframe finishes (re-)mounting and the bridge inside
   *  has installed. Awaited by widget.render dispatch so the engine can't
   *  send the next dom.click before the new bridge is listening. */
  awaitRenderComplete(timeoutMs: number): Promise<void>;
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

  // Tracks the widget URL currently loaded in the iframe. Same name =
  // we just postMessage the new mock (no reload, no await needed).
  // Different name = iframe will remount, so wait for render.complete
  // before the engine fires the next dispatch (otherwise the click
  // races a half-loaded iframe).
  let activeWidgetName: string | null = null;
  const widget: Driver = {
    ...widgetDriver,
    dispatch: widgetDispatch({
      mount: async () => {
        await useStudioStore.getState().loadWidget();
      },
      bridge,
      applyMock: async (widgetName, mock) => {
        await useStudioStore
          .getState()
          .applyWidgetMock(widgetName, mock as WidgetMock);
        if (activeWidgetName !== widgetName) {
          activeWidgetName = widgetName;
          try {
            await bridge.awaitRenderComplete(3000);
          } catch {
            /* selector miss on the next step is more informative than
               hanging here forever */
          }
        } else {
          // Same widget, mock-only update via postMessage. Wait two
          // animation frames so the iframe has time to receive the
          // message, the widget runs its openai:set_globals listener,
          // and React commits the re-render before the engine fires the
          // next dispatch.
          await waitFrames(2);
        }
      },
      onBusEmit,
    }) as Driver["dispatch"],
    attach: widgetAttach({
      mount: async () => undefined,
      bridge,
      applyMock: async () => undefined,
      onBusEmit,
    }) as Driver["attach"],
  };

  return [studio, mcp, widget];
}

/** Wait for N consecutive animation frames. Used after a mock update
 *  is posted to the widget iframe so the browser has time to paint and
 *  React has time to commit the re-render before the engine fires the
 *  next dispatch. ~16ms per frame on a 60fps display. */
function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(n);
  });
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
