import { Action } from "./types";
import { ToolCallAction } from "./tool_call";
import { ResourceReadAction } from "./resource_read";
import { WidgetClickAction } from "./widget_click";
import { WidgetTextInputAction } from "./widget_text_input";
import { WidgetCanvasClickAction } from "./widget_canvas_click";
import { reconstructEvent } from "@/lib/event";
import type { AssertablePoint } from "@/lib/assertion/types";

export * from "./types";
export * from "./tool_call";
export * from "./resource_read";
export * from "./widget_click";
export * from "./widget_text_input";
export * from "./widget_canvas_click";

/**
 * Rebuild a live Action instance from its serialized `toJSON()` blob — the
 * inverse of `Action.toJSON()`. Returns `null` for unknown action types so
 * the replay runner can skip them instead of failing the whole run.
 */
/**
 * Rebuild a LIVE Action instance from a recorded JSON blob — used by the
 * replay runner. Live actions start with `events: []` on purpose: the
 * recorded events live on the JSON (`source.action.events`) and are used
 * only for assertion comparison. Copying them onto the live instance
 * would double-count when execute() emits its own observations.
 */
export function reconstructAction(json: {
  type: string;
  data: any;
}): Action | null {
  switch (json.type) {
    case "TOOL_CALL":
      return new ToolCallAction(json.data.tool, json.data.params);
    case "RESOURCE_READ":
      return new ResourceReadAction(json.data.uri);
    case "WIDGET_CLICK":
      return new WidgetClickAction(
        json.data.widgetId,
        json.data.candidates,
        json.data.fallbackText,
      );
    case "WIDGET_TEXT_INPUT":
      return new WidgetTextInputAction(
        json.data.widgetId,
        json.data.candidates,
        json.data.value,
        json.data.fallbackText,
      );
    case "WIDGET_CANVAS_CLICK":
      return new WidgetCanvasClickAction(
        json.data.widgetId,
        json.data.canvas,
        json.data.nx,
        json.data.ny,
      );
    default:
      return null;
  }
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
    case "WIDGET_TEXT_INPUT":
      return WidgetTextInputAction.assertablePoints;
    case "WIDGET_CANVAS_CLICK":
      return WidgetCanvasClickAction.assertablePoints;
    default:
      return [];
  }
}
