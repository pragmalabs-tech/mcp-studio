import { extractWidgetUri } from "@/lib/studio/tool-category";
import type { SelectedItem } from "@/lib/studio/stores/widget-store";

export function selectedIsWidgetTool(selected: SelectedItem | null): boolean {
  if (selected?.type === "tool")
    return extractWidgetUri(selected.tool.meta) !== null;
  if (selected?.type === "widget") return true;
  return false;
}
