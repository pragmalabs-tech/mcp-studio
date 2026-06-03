import { extractWidgetUri } from "@/lib/studio/tool-category";
import type { SelectedItem } from "@/lib/studio/stores/widget-store";
import type { ActionEntry } from "@/lib/studio/stores/types";

export function selectedIsWidgetTool(selected: SelectedItem | null): boolean {
  if (selected?.type === "tool")
    return extractWidgetUri(selected.tool.meta) !== null;
  if (selected?.type === "widget") return true;
  return false;
}

export interface ResourceResult {
  dataJson: string;
  htmlContent: string | null;
  mimeType: string | null;
}

export function extractResourceResult(
  actions: ActionEntry[],
): ResourceResult | null {
  const reads = actions.filter((a) => a.method === "resources/read");
  if (reads.length === 0) return null;
  const last = reads[reads.length - 1];
  try {
    const parsed = JSON.parse(last.args);
    const result = parsed.result;
    const contents: any[] = result?.contents ?? [];
    const first = contents[0];
    const mimeType: string | null = first?.mimeType ?? null;
    const isHtml =
      typeof mimeType === "string" && mimeType.includes("text/html");
    const htmlContent: string | null =
      isHtml && typeof first?.text === "string" ? first.text : null;

    // Hide the huge HTML body from the Data tab to keep it readable
    const displayResult = htmlContent
      ? {
          ...result,
          contents: contents.map((c: any, idx: number) =>
            idx === 0
              ? { ...c, text: "(HTML content — see HTML Source tab)" }
              : c,
          ),
        }
      : result;

    return {
      dataJson: JSON.stringify(displayResult ?? parsed, null, 2),
      htmlContent,
      mimeType,
    };
  } catch {
    return { dataJson: last.args, htmlContent: null, mimeType: null };
  }
}
