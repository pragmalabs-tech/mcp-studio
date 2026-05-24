import { Event, type EventResult } from "./types";

export class ToolsCallEvent extends Event<{ tool: string; params: unknown }> {
  constructor(tool: string, params: unknown, result?: EventResult) {
    super("tools/call", { tool, params }, result);
  }
}
