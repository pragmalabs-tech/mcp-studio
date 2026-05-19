import { Sparkles, Eye, Pencil, Wrench, type LucideIcon } from "lucide-react";
import type { McpToolInfo } from "./api";

export const ToolCategory = {
  Interactive: "interactive",
  ReadOnly: "read_only",
  Destructive: "destructive",
  Other: "other",
} as const;
export type ToolCategory = (typeof ToolCategory)[keyof typeof ToolCategory];

export const TOOL_CATEGORY_ORDER: ToolCategory[] = [
  ToolCategory.Interactive,
  ToolCategory.ReadOnly,
  ToolCategory.Destructive,
  ToolCategory.Other,
];

export type ToolCategoryTone =
  | "interactive"
  | "readonly"
  | "destructive"
  | "other";

export interface ToolCategoryMeta {
  label: string;
  description: string;
  icon: LucideIcon | null;
  tone: ToolCategoryTone;
}

export const TOOL_CATEGORY_META: Record<ToolCategory, ToolCategoryMeta> = {
  [ToolCategory.Interactive]: {
    label: "Interactive Tools",
    description: "Tools that render a UI widget when invoked.",
    icon: Sparkles,
    tone: "interactive",
  },
  [ToolCategory.ReadOnly]: {
    label: "Read-only Tools",
    description: "Tools the server declared as side-effect-free.",
    icon: Eye,
    tone: "readonly",
  },
  [ToolCategory.Destructive]: {
    label: "Write/Delete Tools",
    description: "Tools the server declared as making writes or deletions.",
    icon: Pencil,
    tone: "destructive",
  },
  [ToolCategory.Other]: {
    label: "Other Tools",
    description: "Tools without read-only or write/delete annotations.",
    icon: Wrench,
    tone: "other",
  },
};

/** Extract widget name from ui:// URI pattern in meta.
 *  Supports both `ui://widget/{name}` (mcpr convention) and
 *  `ui://{app}/{path}` (MCP Apps spec). */
export function extractWidgetUri(
  meta: Record<string, unknown> | undefined,
): string | null {
  if (!meta) return null;
  const candidates: string[] = [];

  // Claude: meta.ui.resourceUri
  const ui = meta.ui as Record<string, unknown> | undefined;
  if (ui?.resourceUri && typeof ui.resourceUri === "string")
    candidates.push(ui.resourceUri as string);
  // Also check ui.uri (from tools/list meta)
  if (ui?.uri && typeof ui.uri === "string") candidates.push(ui.uri as string);
  // OpenAI: openai/outputTemplate
  const tmpl = meta["openai/outputTemplate"];
  if (typeof tmpl === "string") candidates.push(tmpl);

  for (const uri of candidates) {
    // ui://widget/{name}(.html)? - existing convention
    const m = uri.match(/^ui:\/\/widget\/(.+?)(?:\.html)?$/);
    if (m) return m[1];
    // ui://{app}/{path}(.html)? - MCP Apps spec
    // Use app name (first segment) as the widget name since the path is often generic (index.html)
    const g = uri.match(/^ui:\/\/([^/]+)\/([^/]+?)(?:\.html)?$/);
    if (g) {
      const [, app, file] = g;
      return file === "index" ? app : file;
    }
  }
  return null;
}

/** Classify a tool by widget presence, then declared annotations.
 *  Widget wins over read-only so widget-bearing read-only tools (e.g. `get_course`)
 *  surface under Interactive where their primary value lives. */
export function classifyTool(tool: McpToolInfo): ToolCategory {
  if (extractWidgetUri(tool.meta)) return ToolCategory.Interactive;
  if (tool.annotations?.readOnlyHint) return ToolCategory.ReadOnly;
  if (tool.annotations?.destructiveHint) return ToolCategory.Destructive;
  return ToolCategory.Other;
}
