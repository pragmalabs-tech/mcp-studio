import { Action } from "./types";
import { ResourceReadRequestedEvent } from "@/lib/event/resource_events";
import type { Event } from "@/lib/event/types";

export class ResourceReadAction extends Action<{ uri: string }> {
  constructor(uri: string) {
    super("RESOURCE_READ", { uri });
  }

  execute(): Event[] {
    return [
      new ResourceReadRequestedEvent({
        requestId: Date.now(),
        uri: this.data.uri,
      }),
    ];
  }
}
