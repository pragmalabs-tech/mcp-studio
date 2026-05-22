/**
 * Simple event emitter for MCP responses.
 * Used by McpDriver to listen for responses from the MCP client.
 */

export interface McpResponse {
  requestId: number;
  method?: string;
  tool?: string;
  resourceUri?: string;
  result?: unknown;
  error?: { message: string };
}

type ResponseHandler = (response: McpResponse) => void;

class McpEventBus {
  private handlers: ResponseHandler[] = [];

  onResponse(handler: ResponseHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  emitResponse(response: McpResponse): void {
    for (const handler of this.handlers) {
      handler(response);
    }
  }
}

export const mcpEventBus = new McpEventBus();
