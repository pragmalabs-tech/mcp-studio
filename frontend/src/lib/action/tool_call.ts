import { Action } from "./types";
import { ToolCallRequestedEvent } from "@/lib/event/tool_events";
import type { Event } from "@/lib/event/types";

export class ToolCallAction extends Action<{
  tool: string;
  params: unknown;
}> {
  constructor(tool: string, params: unknown) {
    super("TOOL_CALL", { tool, params });
  }

  execute(): Event[] {
    return [
      new ToolCallRequestedEvent({
        requestId: Date.now(),
        tool: this.data.tool,
        params: this.data.params,
      }),
    ];
  }
}
