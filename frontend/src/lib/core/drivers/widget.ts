/**
 * widget driver — owns state.widgets (open stack + renderCount); shares
 * state.network.errorCount.
 *
 * DOM events (`dom.click` etc.) are pure observations: they don't move
 * state directly. What they cause (a tools/call, a re-render) appears
 * as the next Action in the trace and that transition is what runs.
 */

import type { Driver, State, WidgetAction } from "../types";

const VOLATILE = [
  "open[*].data.id",
  "open[*].data.created_at",
  "open[*].data.updated_at",
  "open[*].data.data.id",
  "open[*].data.data.created_at",
  "open[*].data.data.updated_at",
] as const;

function apply(state: State, action: WidgetAction): State {
  if (action.kind === "opened") {
    return {
      ...state,
      widgets: {
        renderCount: state.widgets.renderCount + 1,
        open: [
          ...state.widgets.open,
          {
            uri: action.payload.uri,
            data: action.payload.data,
            mounted: true,
            hasErrors: false,
          },
        ],
      },
    };
  }
  if (action.kind === "runtime_error") {
    const open = state.widgets.open;
    const next =
      open.length > 0
        ? open.map((w, i) =>
            i === open.length - 1 ? { ...w, hasErrors: true } : w,
          )
        : open;
    return {
      ...state,
      widgets: { ...state.widgets, open: next },
      network: { ...state.network, errorCount: state.network.errorCount + 1 },
    };
  }
  // dom.* — pure observation, no state change
  return state;
}

export const widgetDriver: Driver<WidgetAction> = {
  id: "widget",
  initialSlice: () => ({ renderCount: 0, open: [] }) as State["widgets"],
  apply,
  volatilePaths: () => VOLATILE,
};

// ── runtime ──────────────────────────────────────────────────────────────
// Phase 5: dispatch mounts widgets and dispatches DOM events through the
// iframe bridge; attach observes runtime errors and render.complete
// events from the bus to surface widget.opened / runtime_error Actions.

import type { SelectorChain } from "@/lib/recorder/schema";
import type { BusEntry } from "./mcp";

export interface WidgetRuntimeDeps {
  /** Mount a widget in the iframe. Receives the URI to fetch. */
  mount(uri: string): Promise<void>;
  /** Dispatch a DOM event into the iframe bridge. */
  bridge: {
    dispatch(
      selectors: SelectorChain,
      kind: string,
      extra?: unknown,
    ): Promise<void>;
  };
  onBusEmit(handler: (entry: BusEntry) => void): () => void;
}

export function widgetDispatch(
  deps: WidgetRuntimeDeps,
): (action: WidgetAction) => Promise<void> {
  return async (action) => {
    if (action.kind === "opened") {
      await deps.mount(action.payload.uri);
      return;
    }
    if (action.kind === "runtime_error") return; // observed, not driven
    // dom.* — translate kind to bridge selector chain dispatch.
    await deps.bridge.dispatch(
      action.payload.selectors,
      action.kind,
      action.payload,
    );
  };
}

export function widgetAttach(deps: WidgetRuntimeDeps) {
  return (emit: (a: WidgetAction) => void): (() => void) => {
    return deps.onBusEmit((entry) => {
      if (entry.kind === "widget.render.complete") {
        if (entry.hasRuntimeErrors) {
          emit({
            driver: "widget",
            kind: "runtime_error",
            source: "widget",
            payload: { message: "iframe runtime error" },
          });
        }
        return;
      }
      // DOM events surfaced from the iframe bridge.
      if (
        entry.kind === "widget.dom.click" ||
        entry.kind === "widget.dom.input" ||
        entry.kind === "widget.dom.change" ||
        entry.kind === "widget.dom.submit" ||
        entry.kind === "widget.dom.keydown"
      ) {
        emit({
          driver: "widget",
          kind: entry.kind.slice("widget.".length) as
            | "dom.click"
            | "dom.input"
            | "dom.change"
            | "dom.submit"
            | "dom.keydown",
          source: "user",
          payload: entry as never,
        });
      }
    });
  };
}
