/**
 * mcp driver — owns state.tools (per-tool stats) and state.resources
 * (per-uri stats for `resources/read`); shares state.network counters
 * with widget driver.
 *
 * `mcp.response.payload.{method, tool, resourceUri}` are set at capture
 * time from the matching request so transitions attribute results
 * without walking the trace.
 */

import type {
  Driver,
  Matcher,
  McpAction,
  ResourceResultProjection,
  ResourceStats,
  ResourceWidgetMeta,
  State,
  ToolStats,
} from "../types";

const VOLATILE = [
  "*.lastResult.id",
  "*.lastResult.created_at",
  "*.lastResult.updated_at",
  "*.lastResult.data.id",
  "*.lastResult.data.created_at",
  "*.lastResult.data.updated_at",
] as const;

// Shape-asserted instead of silently dropped: the MCP server is
// supposed to return ISO-8601 here; replacing equality with format
// validation keeps the assertion meaningful across runs. The
// `context` block lives inside `structuredContent` per MCP spec for
// tools that emit structured results.
const MATCH: Record<string, Matcher> = {
  "*.lastResult.structuredContent.context.current_datetime": "@iso8601",
  "*.lastResult.structuredContent.context.current_date_human": "@any",
};

function apply(state: State, action: McpAction): State {
  if (action.kind === "request") {
    const name = toolsCallName(action.payload.method, action.payload.params);
    const uri = resourcesReadUri(action.payload.method, action.payload.params);
    return {
      ...state,
      tools: name ? bump(state.tools, name) : state.tools,
      resources: uri ? bumpResource(state.resources, uri) : state.resources,
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
        : { ...prev, lastResult: projectResult(action.payload.result) },
    };
  }
  const uri = action.payload.resourceUri;
  let resources = state.resources;
  if (uri) {
    const prev: ResourceStats = resources[uri] ?? { readCount: 0 };
    resources = {
      ...resources,
      [uri]: action.payload.error
        ? { ...prev, lastError: action.payload.error }
        : {
            ...prev,
            lastResult: projectResourceResult(action.payload.result),
          },
    };
  }
  return {
    ...state,
    tools,
    resources,
    network: {
      ...state.network,
      responseCount: state.network.responseCount + 1,
      errorCount: state.network.errorCount + (action.payload.error ? 1 : 0),
    },
  };
}

/** Project a tools/call result for the state scoreboard. When the
 *  response carries `structuredContent` (the canonical typed form),
 *  drop the redundant serialized `content[]` so the differ doesn't
 *  report the same change twice (once on the parsed tree, once on the
 *  serialized string). For widget / HTML responses without
 *  `structuredContent`, `content[]` stays — that's the only payload. */
function projectResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  if (r.structuredContent === undefined) return result;
  const { content: _content, ...rest } = r;
  return rest;
}

function toolsCallName(method: string, params: unknown): string | null {
  if (method !== "tools/call") return null;
  const n = (params as { name?: unknown } | null | undefined)?.name;
  return typeof n === "string" && n.length > 0 ? n : null;
}

function resourcesReadUri(method: string, params: unknown): string | null {
  if (method !== "resources/read") return null;
  const u = (params as { uri?: unknown } | null | undefined)?.uri;
  return typeof u === "string" && u.length > 0 ? u : null;
}

function bump(tools: State["tools"], name: string): State["tools"] {
  const prev = tools[name] ?? { callCount: 0 };
  return { ...tools, [name]: { ...prev, callCount: prev.callCount + 1 } };
}

function bumpResource(
  resources: State["resources"],
  uri: string,
): State["resources"] {
  const prev = resources[uri] ?? { readCount: 0 };
  return { ...resources, [uri]: { ...prev, readCount: prev.readCount + 1 } };
}

/** Project a resources/read result into the contract surface we want
 *  the differ to assert on: number of content entries, MIME type, HTML
 *  flag, and widget metadata (CSP domains + widget domain from the
 *  OpenAI Apps SDK `_meta` block). The raw HTML body is intentionally
 *  dropped — it would drift on every whitespace change and isn't a
 *  useful assertion target. */
function projectResourceResult(result: unknown): ResourceResultProjection {
  const contents = readContents(result);
  const first = contents[0] as Record<string, unknown> | undefined;
  const meta =
    first && typeof first._meta === "object" && first._meta !== null
      ? (first._meta as Record<string, unknown>)
      : {};
  const widget = extractWidgetMeta(meta);
  return {
    contentCount: contents.length,
    mimeType: typeof first?.mimeType === "string" ? first.mimeType : undefined,
    hasHtml: typeof first?.text === "string" && looksLikeHtml(first.text),
    ...(widget ? { widget } : {}),
  };
}

function readContents(result: unknown): unknown[] {
  if (!result || typeof result !== "object") return [];
  const c = (result as { contents?: unknown }).contents;
  return Array.isArray(c) ? c : [];
}

function extractWidgetMeta(
  meta: Record<string, unknown>,
): ResourceWidgetMeta | null {
  const csp = meta["openai/widgetCSP"];
  const domain = meta["openai/widgetDomain"];
  const hasCsp = csp && typeof csp === "object";
  const hasDomain = typeof domain === "string";
  if (!hasCsp && !hasDomain) return null;
  const cspObj = (hasCsp ? csp : {}) as Record<string, unknown>;
  return {
    domain: hasDomain ? (domain as string) : undefined,
    cspConnect: stringArray(cspObj.connect_domains),
    cspResource: stringArray(cspObj.resource_domains),
    cspFrame: stringArray(cspObj.frame_domains),
  };
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function looksLikeHtml(s: string): boolean {
  return /<html|<!doctype|<body|<head/i.test(s.slice(0, 2000));
}

export const mcpDriver: Driver<McpAction> = {
  id: "mcp",
  initialSlice: () => ({}) as State["tools"],
  apply,
  volatilePaths: () => VOLATILE,
  matchPaths: () => MATCH,
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
    // Pair responses to their request. The bus emits user-, engine-, and
    // widget-source requests on the same channel; track every request id
    // regardless of source so a server response carries the method (and
    // tool name / resource uri when applicable) for attribution.
    const requestMetaByReqId = new Map<
      number,
      { method: string; tool?: string; resourceUri?: string }
    >();

    return deps.onBusEmit((entry) => {
      if (entry.kind === "mcp.request") {
        const reqId = Number(entry.id);
        const method = String(entry.method);
        const meta: { method: string; tool?: string; resourceUri?: string } = {
          method,
        };
        if (method === "tools/call") {
          const name = (entry.params as { name?: unknown } | null)?.name;
          if (typeof name === "string") meta.tool = name;
        } else if (method === "resources/read") {
          const uri = (entry.params as { uri?: unknown } | null)?.uri;
          if (typeof uri === "string") meta.resourceUri = uri;
        }
        requestMetaByReqId.set(reqId, meta);
        // Only widget-source requests need to be appended to the
        // captured trace — user/engine ones were already pushed by
        // the engine's own dispatch loop.
        if (entry.source === "widget") {
          emit({
            driver: "mcp",
            kind: "request",
            source: "widget",
            payload: {
              id: reqId,
              method,
              params: entry.params,
            },
          });
        }
        return;
      }
      if (entry.kind === "mcp.response") {
        const requestId = Number(entry.requestId);
        const meta = requestMetaByReqId.get(requestId);
        emit({
          driver: "mcp",
          kind: "response",
          source: "server",
          payload: {
            requestId,
            method: meta?.method,
            tool: meta?.tool,
            resourceUri: meta?.resourceUri,
            durationMs: Number(entry.durationMs ?? 0),
            result: entry.result,
            error: entry.error as { message: string } | undefined,
          },
        });
      }
    });
  };
}
