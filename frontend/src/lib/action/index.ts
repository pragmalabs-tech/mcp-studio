import { Action } from "./types";
import { ToolCallAction } from "./tool_call";
import { ResourceReadAction } from "./resource_read";
import type { AssertablePoint } from "@/lib/assertion/types";

export * from "./types";
export * from "./tool_call";
export * from "./resource_read";

/**
 * Rebuild a live Action instance from its serialized `toJSON()` blob — the
 * inverse of `Action.toJSON()`. Returns `null` for unknown action types so
 * the replay runner can skip them instead of failing the whole run.
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
    default:
      return [];
  }
}
