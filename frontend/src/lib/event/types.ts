import type { State } from "@/lib/state/types";

export abstract class Event<T = any> {
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

  // Apply event to state → return new state
  abstract apply(state: State): State;

  toJSON(): object {
    return {
      id: this.id,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
    };
  }
}

// Simple event bus for pub/sub
export class EventBus {
  private handlers: Array<(event: Event) => void> = [];

  subscribe(handler: (event: Event) => void): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  emit(event: Event): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

// Global event bus instance
export const eventBus = new EventBus();
