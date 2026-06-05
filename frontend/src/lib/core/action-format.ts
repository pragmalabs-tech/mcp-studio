import { ResourceReadAction, ToolCallAction, type Action } from "@/lib/action";

type AnyAction = Action | { type: string; data: any } | null | undefined;

function asJson(a: AnyAction): { type: string; data: any } | null {
  if (!a) return null;
  if (a instanceof ToolCallAction || a instanceof ResourceReadAction) {
    return { type: a.type, data: a.data };
  }
  if (typeof (a as any).type === "string") {
    return { type: (a as any).type, data: (a as any).data };
  }
  return null;
}

/** "Click" / "Double-click" / "Triple-click" / "Click ×N" from `e.detail`. */
export function clickVerb(detail: unknown): string {
  const n = typeof detail === "number" && detail > 0 ? detail : 1;
  if (n <= 1) return "Click";
  if (n === 2) return "Double-click";
  if (n === 3) return "Triple-click";
  return `Click ×${n}`;
}

/** Percent position of a normalized 0..1 coord, e.g. 0.674 → "67%". */
function pct(v: unknown): string {
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "?";
}

/** Short, human-readable label for an action (used by the run header). */
export function actionLabel(a: AnyAction): string {
  const j = asJson(a);
  if (!j) return "Action";
  switch (j.type) {
    case "TOOL_CALL":
      return `Tool · ${j.data?.tool ?? "?"}`;
    case "RESOURCE_READ":
      return `Resource · ${j.data?.uri ?? "?"}`;
    case "WIDGET_TEXT_INPUT":
      return `Type · ${j.data?.value ?? ""}`;
    case "WIDGET_CLICK":
      return `${clickVerb(j.data?.detail)} · ${j.data?.fallbackText ?? j.data?.candidates?.[0] ?? "?"}`;
    case "WIDGET_CANVAS_CLICK":
      return `Canvas ${clickVerb(j.data?.detail).toLowerCase()} · ${pct(j.data?.nx)}×${pct(j.data?.ny)}`;
    default:
      return j.type;
  }
}

/** Optional secondary line (args summary). */
export function actionSummary(a: AnyAction): string {
  const j = asJson(a);
  if (!j) return "";
  if (j.type === "TOOL_CALL") {
    const params = j.data?.params;
    if (params && typeof params === "object") {
      try {
        const s = JSON.stringify(params);
        return s.length > 80 ? s.slice(0, 77) + "…" : s;
      } catch {
        return "";
      }
    }
  }
  return "";
}
