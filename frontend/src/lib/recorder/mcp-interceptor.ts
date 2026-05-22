import { mcpEventBus } from "@/lib/mcp/events";
import { recorder } from "./bus";
import { ToolCallAction } from "@/lib/action/tool_call";
import { ResourceReadAction } from "@/lib/action/resource_read";

let nextId = 1;

type FlushFn = () => void;
const flushHooks = new Set<FlushFn>();

/** Register a callback that the interceptor will call before emitting an `mcp.request`. */
export function registerPreRequestFlush(fn: FlushFn): () => void {
  flushHooks.add(fn);
  return () => flushHooks.delete(fn);
}

function flushPending() {
  for (const fn of flushHooks) {
    try {
      fn();
    } catch {
      /* hooks must not break the call path */
    }
  }
}

function serializeError(err: unknown): { message: string } {
  if (err instanceof Error) return { message: err.message };
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

export type RawCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export async function recordedMcpCall(
  raw: RawCall,
  method: string,
  params: Record<string, unknown> = {},
  _source?: any, // Backward compatibility param (not used)
): Promise<unknown> {
  flushPending();
  const requestId = nextId++;

  // Extract tool name or resource URI from params
  let tool: string | undefined;
  let resourceUri: string | undefined;

  if (method === "tools/call" && typeof (params as any).name === "string") {
    tool = (params as any).name;
  } else if (method === "resources/read" && typeof (params as any).uri === "string") {
    resourceUri = (params as any).uri;
  }

  // Record action if recorder is active
  if (recorder.mode === "recording") {
    if (method === "tools/call" && tool) {
      const action = new ToolCallAction(tool, (params as any).arguments || {});
      recorder.record(action);
    } else if (method === "resources/read" && resourceUri) {
      const action = new ResourceReadAction(resourceUri);
      recorder.record(action);
    }
  }

  try {
    const result = await raw(method, params);

    // Emit response event to MCP event bus
    mcpEventBus.emitResponse({
      requestId,
      method,
      tool,
      resourceUri,
      result,
    });

    return result;
  } catch (err) {
    // Emit error response to MCP event bus
    mcpEventBus.emitResponse({
      requestId,
      method,
      tool,
      resourceUri,
      error: serializeError(err),
    });

    throw err;
  }
}
