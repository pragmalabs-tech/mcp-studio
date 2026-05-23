import { mcpEventBus } from "@/lib/mcp/events";
import { recorder } from "./bus";
import { ToolCallAction } from "@/lib/action/tool_call";
import { ResourceReadAction } from "@/lib/action/resource_read";

let nextId = 1;

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

/**
 * Wraps an MCP `raw` call so that successful and failed responses fan out
 * to (a) the recorder buffer (as a typed `Action` instance) and (b) the
 * `mcpEventBus` (for live state updates and widget-HTML derivation).
 */
export async function recordedMcpCall(
  raw: RawCall,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const requestId = nextId++;

  let tool: string | undefined;
  let resourceUri: string | undefined;

  if (method === "tools/call" && typeof (params as any).name === "string") {
    tool = (params as any).name;
  } else if (
    method === "resources/read" &&
    typeof (params as any).uri === "string"
  ) {
    resourceUri = (params as any).uri;
  }

  // Build the typed Action up-front so we can stamp it with success / error
  // after the call returns. Only created when the recorder is live.
  let action: ToolCallAction | ResourceReadAction | undefined;
  if (recorder.mode === "recording") {
    if (method === "tools/call" && tool) {
      action = new ToolCallAction(tool, (params as any).arguments || {});
    } else if (method === "resources/read" && resourceUri) {
      action = new ResourceReadAction(resourceUri);
    }
  }

  try {
    const result = await raw(method, params);

    if (action) {
      action.setResult(true, result);
      recorder.record(action);
    }

    mcpEventBus.emitResponse({
      requestId,
      method,
      tool,
      resourceUri,
      result,
    });

    return result;
  } catch (err) {
    if (action) {
      action.setResult(false, undefined, serializeError(err));
      recorder.record(action);
    }

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
