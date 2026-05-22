import type { Event } from "@/lib/event/types";

export abstract class Action<T = any> {
  readonly id: string;
  readonly type: string;
  readonly data: T;
  readonly timestamp: number;

  constructor(type: string, data: T) {
    this.id = crypto.randomUUID();
    this.type = type;
    this.data = data;
    this.timestamp = Date.now();
  }

  // Execute action → return events
  abstract execute(): Event[];

  // For comparison (can be extended later)
  matches(other: Action): boolean {
    return this.type === other.type;
  }

  toJSON(): object {
    return {
      id: this.id,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
    };
  }
}
