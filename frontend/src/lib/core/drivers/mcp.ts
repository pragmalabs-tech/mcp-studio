/**
 * mcp driver — owns state.tools (per-tool stats); shares state.network
 * counters with widget driver.
 *
 * `mcp.response.payload.tool` is set at capture time for tools/call
 * responses so transitions attribute results without heuristic matching.
 */

import type { Driver, McpAction, State, ToolStats } from "../types";

const VOLATILE = [
  "*.lastResult.id",
  "*.lastResult.created_at",
  "*.lastResult.updated_at",
  "*.lastResult.context.current_datetime",
  "*.lastResult.context.current_date_human",
  "*.lastResult.data.id",
  "*.lastResult.data.created_at",
  "*.lastResult.data.updated_at",
] as const;

function apply(state: State, action: McpAction): State {
  if (action.kind === "request") {
    const name = toolsCallName(action.payload.method, action.payload.params);
    return {
      ...state,
      tools: name ? bump(state.tools, name) : state.tools,
      network: {
        ...state.network,
        requestCount: state.network.requestCount + 1,
      },
    };
  }
  // response
  const name = action.payload.tool;
  let tools = state.tools;
  if (name) {
    const prev: ToolStats = tools[name] ?? { callCount: 0 };
    tools = {
      ...tools,
      [name]: action.payload.error
        ? { ...prev, lastError: action.payload.error }
        : { ...prev, lastResult: action.payload.result },
    };
  }
  return {
    ...state,
    tools,
    network: {
      ...state.network,
      responseCount: state.network.responseCount + 1,
      errorCount: state.network.errorCount + (action.payload.error ? 1 : 0),
    },
  };
}

function toolsCallName(method: string, params: unknown): string | null {
  if (method !== "tools/call") return null;
  const n = (params as { name?: unknown } | null | undefined)?.name;
  return typeof n === "string" && n.length > 0 ? n : null;
}

function bump(tools: State["tools"], name: string): State["tools"] {
  const prev = tools[name] ?? { callCount: 0 };
  return { ...tools, [name]: { ...prev, callCount: prev.callCount + 1 } };
}

export const mcpDriver: Driver<McpAction> = {
  id: "mcp",
  initialSlice: () => ({}) as State["tools"],
  apply,
  volatilePaths: () => VOLATILE,
};

// ── runtime ──────────────────────────────────────────────────────────────
// Phase 5: dispatch fires user/engine-source requests through the live
// MCP client; attach subscribes to the bus to translate widget-source
// requests and server responses into new Actions.

export interface McpRuntimeDeps {
  /** Live MCP client. Returns the JSON-RPC response result. */
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  /** Subscribe to recorder bus events; return unsubscribe. */
  onBusEmit(handler: (entry: BusEntry) => void): () => void;
}

/** A bus entry is whatever the recorder emits — we narrow at runtime. */
export interface BusEntry {
  kind: string;
  [k: string]: unknown;
}

export function mcpDispatch(
  deps: McpRuntimeDeps,
): (action: McpAction) => Promise<void> {
  return async (action) => {
    if (action.kind !== "request") return;
    if (action.source === "widget") return; // iframe fires its own
    await deps.call(
      action.payload.method,
      (action.payload.params ?? {}) as Record<string, unknown>,
    );
  };
}

export function mcpAttach(deps: McpRuntimeDeps) {
  return (emit: (a: McpAction) => void): (() => void) => {
    // Pair responses to their request's tool name. The bus emits user-,
    // engine-, and widget-source requests on the same channel; track all
    // tools/call ids regardless of source so a server response can be
    // attributed to the right state.tools.{name} row.
    const toolByReqId = new Map<number, string>();

    return deps.onBusEmit((entry) => {
      if (entry.kind === "mcp.request") {
        if (entry.method === "tools/call") {
          const name = (entry.params as { name?: unknown } | null)?.name;
          if (typeof name === "string") {
            toolByReqId.set(Number(entry.id), name);
          }
        }
        // Only widget-source requests need to be appended to the
        // captured trace — user/engine ones were already pushed by
        // the engine's own dispatch loop.
        if (entry.source === "widget") {
          emit({
            driver: "mcp",
            kind: "request",
            source: "widget",
            payload: {
              id: Number(entry.id),
              method: String(entry.method),
              params: entry.params,
            },
          });
        }
        return;
      }
      if (entry.kind === "mcp.response") {
        const requestId = Number(entry.requestId);
        emit({
          driver: "mcp",
          kind: "response",
          source: "server",
          payload: {
            requestId,
            tool: toolByReqId.get(requestId),
            durationMs: Number(entry.durationMs ?? 0),
            result: entry.result,
            error: entry.error as { message: string } | undefined,
          },
        });
      }
    });
  };
}
