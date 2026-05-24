import { Action } from "./types";
import { ToolCallAction } from "./tool_call";
import { ResourceReadAction } from "./resource_read";
import { WidgetClickAction } from "./widget_click";
import { reconstructEvent } from "@/lib/event";
import type { AssertablePoint } from "@/lib/assertion/types";

export * from "./types";
export * from "./tool_call";
export * from "./resource_read";
export * from "./widget_click";

/**
 * Rebuild a live Action instance from its serialized `toJSON()` blob — the
 * inverse of `Action.toJSON()`. Returns `null` for unknown action types so
 * the replay runner can skip them instead of failing the whole run.
 */
export function reconstructAction(json: {
  type: string;
  data: any;
  events?: Array<{ type: string; data: any; result?: any }>;
}): Action | null {
  let action: Action | null = null;
  switch (json.type) {
    case "TOOL_CALL":
      action = new ToolCallAction(json.data.tool, json.data.params);
      break;
    case "RESOURCE_READ":
      action = new ResourceReadAction(json.data.uri);
      break;
    case "WIDGET_CLICK":
      action = new WidgetClickAction(
        json.data.widgetId,
        json.data.candidates,
        json.data.fallbackText,
      );
      break;
    default:
      return null;
  }
  if (json.events) {
    const rebuilt = json.events.map(reconstructEvent);
    for (const e of rebuilt) {
      if (e) action.events.push(e);
    }
  }
  return action;
}

/**
 * Look up the assertable surface for a recorded action by its `type` string.
 * Lets the test detail view render assertion-config rows without having to
 * instantiate a live Action just to read its static points.
 */
export function assertablePointsForType(type: string): AssertablePoint[] {
  switch (type) {
    case "TOOL_CALL":
      return ToolCallAction.assertablePoints;
    case "RESOURCE_READ":
      return ResourceReadAction.assertablePoints;
    case "WIDGET_CLICK":
      return WidgetClickAction.assertablePoints;
    default:
      return [];
  }
}
