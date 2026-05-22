import { Event } from "./types";
import type { State } from "@/lib/state/types";

export class ToolCallRequestedEvent extends Event<{
  requestId: number;
  tool: string;
  params: unknown;
}> {
  constructor(data: { requestId: number; tool: string; params: unknown }) {
    super("TOOL_CALL_REQUESTED", data);
  }

  apply(state: State): State {
    const { requestId, tool, params } = this.data;
    const toolState = state.tools[tool] || {
      callCount: 0,
      calls: [],
    };

    return {
      ...state,
      tools: {
        ...state.tools,
        [tool]: {
          ...toolState,
          callCount: toolState.callCount + 1,
          calls: [
            ...toolState.calls,
            {
              requestId,
              params,
              timestamp: Date.now(),
            },
          ],
        },
      },
      network: {
        ...state.network,
        requestCount: state.network.requestCount + 1,
      },
    };
  }
}

export class ToolCallCompletedEvent extends Event<{
  requestId: number;
  tool: string;
  result: unknown;
}> {
  constructor(data: { requestId: number; tool: string; result: unknown }) {
    super("TOOL_CALL_COMPLETED", data);
  }

  apply(state: State): State {
    const { requestId, tool, result } = this.data;
    const toolState = state.tools[tool];
    if (!toolState) return state;

    const updatedCalls = toolState.calls.map((call) =>
      call.requestId === requestId ? { ...call, result } : call,
    );

    return {
      ...state,
      tools: {
        ...state.tools,
        [tool]: {
          ...toolState,
          calls: updatedCalls,
          lastResult: result,
        },
      },
      network: {
        ...state.network,
        responseCount: state.network.responseCount + 1,
      },
    };
  }
}

export class ToolCallFailedEvent extends Event<{
  requestId: number;
  tool: string;
  error: string;
}> {
  constructor(data: { requestId: number; tool: string; error: string }) {
    super("TOOL_CALL_FAILED", data);
  }

  apply(state: State): State {
    const { requestId, tool, error } = this.data;
    const toolState = state.tools[tool];
    if (!toolState) return state;

    const updatedCalls = toolState.calls.map((call) =>
      call.requestId === requestId ? { ...call, error } : call,
    );

    return {
      ...state,
      tools: {
        ...state.tools,
        [tool]: {
          ...toolState,
          calls: updatedCalls,
          lastError: { message: error },
        },
      },
      network: {
        ...state.network,
        errorCount: state.network.errorCount + 1,
      },
    };
  }
}
