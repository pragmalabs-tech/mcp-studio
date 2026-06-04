/**
 * Pure helpers used by `ToolCallAction.execute()` to derive the
 * widget-related outcome from a tool-call response. Kept out of the
 * action class so they're trivial to test and reuse from other callers
 * (replay runner, future automation).
 */

import type { MockData } from "@/lib/studio/mock-openai";
import type { McpResourceInfo } from "@/lib/studio/api";
import { extractWidgetUri } from "@/lib/studio/tool-category";

/**
 * Resolve the actual `ui://` resource URI a tool call wants to render.
 * Returns null when the tool isn't a widget tool.
 *
 *   1. Look at the response `_meta` (or `meta`) for an explicit ui ref.
 *   2. Fall back to fuzzy-matching the tool name against available
 *      `ui://*` resources (mirrors today's `store.resolveWidgetName`
 *      behaviour at `store.ts:1553-1581`).
 *
 * Returns the *full URI* (e.g. `ui://widget/weather`) — the action uses
 * it both as the widget id key and as the argument to `readResource`.
 */
export function resolveWidgetUri(
  meta: Record<string, unknown> | undefined,
  toolName: string | null,
  resources: McpResourceInfo[],
): string | null {
  const uiResources = resources.filter((r) => r.uri.startsWith("ui://"));

  const nameFromMeta = extractWidgetUri(meta);
  if (nameFromMeta) {
    const match = uiResources.find(
      (r) =>
        r.uri.includes(nameFromMeta) &&
        r.mimeType === "text/html;profile=mcp-app",
    );
    if (match) return match.uri;
  }

  if (toolName) {
    const stripped = toolName.replace(
      /^(create|get|list|update|add|delete|remove|submit|review)_/,
      "",
    );
    for (const r of uiResources) {
      const candidate = extractWidgetUri({ ui: { resourceUri: r.uri } });
      if (!candidate) continue;
      if (
        candidate === toolName ||
        toolName.includes(candidate) ||
        candidate.includes(toolName) ||
        candidate === stripped ||
        candidate.includes(stripped) ||
        stripped.includes(candidate)
      ) {
        return r.uri;
      }
    }
  }

  // Last resort: if the server exposes exactly one MCP app widget and nothing
  // matched by name, use it. Servers like Excalidraw have a single canvas
  // resource that is the primary UI for all their tools.
  const appResources = uiResources.filter(
    (r) => r.mimeType === "text/html;profile=mcp-app",
  );
  if (appResources.length === 1) return appResources[0].uri;

  return null;
}

/**
 * Build a `MockData` payload from a tool-call response. Mirrors the
 * extraction logic that used to live inline in `store.execute` at
 * `store.ts:1841-1867`.
 *
 *   - `_meta` / `meta` is forwarded as-is.
 *   - When `content[]` carries a JSON-parseable `text` block, use that as
 *     `toolOutput`; otherwise the full response stands in.
 *   - `theme` / `locale` / `displayMode` come from the live studio.
 */
export function buildMockFromResponse(
  toolResponse: unknown,
  toolInput: unknown,
  display: { theme: string; locale: string; displayMode: string },
): MockData {
  const content = (toolResponse ?? {}) as {
    content?: Array<{ type: string; text?: string }>;
    _meta?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  };
  const meta = content._meta ?? content.meta ?? {};
  let toolOutput: unknown = toolResponse;
  if (content.content) {
    const text = content.content.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        toolOutput = JSON.parse(text);
      } catch {
        toolOutput = text;
      }
    }
  }
  return {
    toolInput,
    toolOutput,
    _meta: meta,
    widgetState: null,
    theme: display.theme,
    locale: display.locale,
    displayMode: display.displayMode,
  };
}
