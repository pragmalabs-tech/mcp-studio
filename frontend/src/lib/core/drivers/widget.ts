/**
 * widget driver — owns state.widgets (open stack + renderCount); shares
 * state.network.errorCount.
 *
 * DOM events (`dom.click` etc.) are pure observations: they don't move
 * state directly. What they cause (a tools/call, a re-render) appears
 * as the next Action in the trace and that transition is what runs.
 */

import type { Driver, State, WidgetAction } from "../types";
import { stripUndefined } from "../util/strip-undefined";

const VOLATILE = [
  "open[*].data.id",
  "open[*].data.created_at",
  "open[*].data.updated_at",
  "open[*].data.data.id",
  "open[*].data.data.created_at",
  "open[*].data.data.updated_at",
  // Legacy openai shim assigns a random callId per outgoing request;
  // it would otherwise drift on every replay.
  "intents[*].params.callId",
] as const;

function apply(state: State, action: WidgetAction): State {
  if (action.kind === "opened") {
    return {
      ...state,
      widgets: {
        ...state.widgets,
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
  if (action.kind === "intent") {
    return {
      ...state,
      widgets: {
        ...state.widgets,
        intents: [
          ...state.widgets.intents,
          { name: action.payload.name, params: action.payload.params },
        ],
      },
    };
  }
  if (action.kind === "render") {
    return {
      ...state,
      widgets: {
        ...state.widgets,
        activeRender: {
          widgetName: action.payload.widgetName,
          mock: action.payload.mock,
        },
      },
    };
  }
  // dom.* — pure observation, no state change
  return state;
}

export const widgetDriver: Driver<WidgetAction> = {
  id: "widget",
  initialSlice: () =>
    ({
      renderCount: 0,
      open: [],
      intents: [],
      activeRender: null,
    }) as State["widgets"],
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
  /** Apply a fresh mock to the widget iframe. Called by the engine when
   *  a widget.render action is dispatched. Mirrors what store.execute()
   *  does during recording — pure setter, no I/O. */
  applyMock(widgetName: string, mock: unknown): Promise<void>;
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
    if (action.kind === "intent") return; // observed, not driven
    if (action.kind === "render") {
      await deps.applyMock(action.payload.widgetName, action.payload.mock);
      return;
    }
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
      // Widget→host intent (sendFollowUpMessage, ui/message, etc.)
      // surfaces as a state-folding action so the differ can assert on
      // the intent name + params.
      //
      // postMessage / structuredClone preserves `undefined`-valued keys
      // that JSON storage drops. Strip them at capture so live replay
      // and JSON-round-tripped recordings produce identical params for
      // the differ. Without this, the differ flags phantom EXTRA drifts
      // that render as "expected: -, got: -" in the UI.
      if (entry.kind === "widget.intent") {
        emit({
          driver: "widget",
          kind: "intent",
          source: "widget",
          payload: {
            name: typeof entry.name === "string" ? entry.name : "(unknown)",
            params: stripUndefined(entry.params),
          },
        });
        return;
      }
      // DOM events from the iframe bridge are NOT echoed back to
      // ambient. The engine drives them via dispatch (user-source
      // actions). If the bridge's capture-phase listener fires on the
      // engine's own synthetic click, echoing it would put a duplicate
      // dom.click in ambient that could be wrongly consumed by a later
      // step's await.
    });
  };
}
