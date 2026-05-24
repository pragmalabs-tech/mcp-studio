import type { Action } from "@/lib/action/types";
import type { Event } from "./types";

/**
 * Routes emitted events to the currently-active Action's `events` list.
 *
 * At most one Action is active at a time — set by `store.execute()` and
 * `replays/runner.ts` around `await action.execute()`. Events emitted while
 * no Action is active are dropped (today: rare — only happens between
 * actions or before any action ever runs).
 */
class EventBus {
  private active: Action | null = null;

  setActive(action: Action | null): void {
    this.active = action;
  }

  current(): Action | null {
    return this.active;
  }

  emit(event: Event): void {
    this.active?.events.push(event);
  }
}

export const eventBus = new EventBus();
