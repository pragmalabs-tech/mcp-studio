import { Event, type EventResult } from "./types";
import { ToolsCallEvent } from "./tools_call";
import { ResourcesReadEvent } from "./resources_read";
import { WidgetRenderEvent } from "./widget_render";

export * from "./types";
export * from "./tools_call";
export * from "./resources_read";
export * from "./widget_render";
export { eventBus } from "./bus";

/**
 * Rebuild a live Event instance from its serialized `toJSON()` blob.
 * Returns null for unknown event types so the recorder can skip them.
 */
export function reconstructEvent(json: {
  type: string;
  data: any;
  result?: EventResult;
}): Event | null {
  switch (json.type) {
    case "tools/call":
      return new ToolsCallEvent(json.data.tool, json.data.params, json.result);
    case "resources/read":
      return new ResourcesReadEvent(json.data.uri, json.result);
    case "widget/render":
      return new WidgetRenderEvent(
        json.data.widgetId,
        json.data.uri,
        json.result,
      );
    default:
      return null;
  }
}
