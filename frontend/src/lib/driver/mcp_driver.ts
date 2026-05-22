import { eventBus } from "@/lib/event/types";
import {
  ToolCallCompletedEvent,
  ToolCallFailedEvent,
} from "@/lib/event/tool_events";
import {
  ResourceReadCompletedEvent,
  ResourceReadFailedEvent,
} from "@/lib/event/resource_events";
import { ToolCallAction } from "@/lib/action/tool_call";
import { ResourceReadAction } from "@/lib/action/resource_read";
import type { Action } from "@/lib/action/types";

export interface McpClientDeps {
  call(method: string, params: unknown): Promise<unknown>;
  onResponse(handler: (response: McpResponse) => void): () => void;
}

export interface McpResponse {
  requestId: number;
  method?: string;
  tool?: string;
  resourceUri?: string;
  result?: unknown;
  error?: { message: string };
}

export class McpDriver {
  private deps: McpClientDeps;

  constructor(deps: McpClientDeps) {
    this.deps = deps;
  }

  // Listen to MCP responses and emit completion events
  attach(signal: AbortSignal): () => void {
    const unsubscribe = this.deps.onResponse((response: McpResponse) => {
      if (response.method === "tools/call" || response.tool) {
        if (response.error) {
          eventBus.emit(
            new ToolCallFailedEvent({
              requestId: response.requestId,
              tool: response.tool || "",
              error: response.error.message,
            })
          );
        } else {
          eventBus.emit(
            new ToolCallCompletedEvent({
              requestId: response.requestId,
              tool: response.tool || "",
              result: response.result,
            })
          );
        }
      } else if (response.method === "resources/read" || response.resourceUri) {
        if (response.error) {
          eventBus.emit(
            new ResourceReadFailedEvent({
              requestId: response.requestId,
              uri: response.resourceUri || "",
              error: response.error.message,
            })
          );
        } else {
          eventBus.emit(
            new ResourceReadCompletedEvent({
              requestId: response.requestId,
              uri: response.resourceUri || "",
              result: response.result,
            })
          );
        }
      }
    });

    signal.addEventListener("abort", unsubscribe);
    return unsubscribe;
  }

  // Execute side effects (call MCP)
  async dispatch(action: Action, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    if (action instanceof ToolCallAction) {
      const method = `tools/call`;
      await this.deps.call(method, {
        name: action.data.tool,
        arguments: action.data.params,
      });
    } else if (action instanceof ResourceReadAction) {
      const method = `resources/read`;
      await this.deps.call(method, {
        uri: action.data.uri,
      });
    }
  }
}
