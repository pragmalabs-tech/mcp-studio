import { Event, type EventResult } from "./types";

export class ResourcesReadEvent extends Event<{ uri: string }> {
  constructor(uri: string, result?: EventResult) {
    super("resources/read", { uri }, result);
  }
}
