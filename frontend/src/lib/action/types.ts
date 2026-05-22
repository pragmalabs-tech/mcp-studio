import type { Event } from "@/lib/event/types";

export abstract class Action<T = any> {
  readonly id: string;
  readonly type: string;
  readonly data: T;
  readonly timestamp: number;

  // Result of executing this action (set after execution completes)
  result?: {
    success: boolean;
    data?: unknown;
    error?: { message: string };
  };

  constructor(type: string, data: T) {
    this.id = crypto.randomUUID();
    this.type = type;
    this.data = data;
    this.timestamp = Date.now();
  }

  // Execute action → return events
  abstract execute(): Event[];

  // Set the result after execution completes
  setResult(
    success: boolean,
    data?: unknown,
    error?: { message: string },
  ): void {
    this.result = { success, data, error };
  }

  // For comparison (can be extended later)
  matches(other: Action): boolean {
    return this.type === other.type;
  }

  toJSON(): object {
    const json: any = {
      id: this.id,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
    };

    // Include result if present
    if (this.result) {
      json.result = this.result;
    }

    return json;
  }
}
