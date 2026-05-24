import { Event, type EventResult } from "./types";

export class WidgetRenderEvent extends Event<{
  widgetId: string;
  uri: string;
}> {
  constructor(widgetId: string, uri: string, result?: EventResult) {
    super("widget/render", { widgetId, uri }, result);
  }
}
