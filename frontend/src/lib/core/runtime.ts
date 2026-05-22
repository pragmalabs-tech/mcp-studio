/**
 * Wires the studio's live deps (recorder bus, MCP client) into the new
 * action/event/state system.
 */

import { recorder } from "@/lib/recorder/bus";
import { mcpCall } from "@/lib/studio/api";
import { mcpEventBus } from "@/lib/mcp/events";
import { McpDriver, type McpClientDeps } from "@/lib/driver/mcp_driver";
import { eventBus } from "@/lib/event/types";
import { createInitialState, applyEvent, type State } from "@/lib/state/types";
import type { Event } from "@/lib/event/types";
import type { Action } from "@/lib/action/types";

/** Runtime state manager - coordinates actions, events, and state */
export class Runtime {
  private state: State;
  private mcpDriver: McpDriver;
  private detachers: Array<() => void> = [];
  private abortController: AbortController | null = null;

  constructor() {
    this.state = createInitialState();

    // Create MCP driver
    const mcpDeps: McpClientDeps = {
      call: (method, params) => mcpCall(method, params as Record<string, unknown>),
      onResponse: (handler) => mcpEventBus.onResponse(handler),
    };
    this.mcpDriver = new McpDriver(mcpDeps);

    // Subscribe to all events to update state
    const unsubscribe = eventBus.subscribe((event: Event) => {
      this.state = applyEvent(this.state, event);
    });
    this.detachers.push(unsubscribe);
  }

  /** Start the runtime (attach drivers) */
  start(): void {
    this.abortController = new AbortController();
    const detach = this.mcpDriver.attach(this.abortController.signal);
    this.detachers.push(detach);
  }

  /** Execute an action */
  async executeAction(action: Action): Promise<void> {
    if (!this.abortController) {
      throw new Error("Runtime not started");
    }

    // 1. Record the action (if recorder is active)
    recorder.record(action);

    // 2. Execute action to generate events
    const events = action.execute();

    // 3. Emit all events (state will be updated via subscription)
    for (const event of events) {
      eventBus.emit(event);
    }

    // 4. Dispatch to driver for side effects
    await this.mcpDriver.dispatch(action, this.abortController.signal);
  }

  /** Get current state */
  getState(): State {
    return this.state;
  }

  /** Stop the runtime (detach drivers) */
  stop(): void {
    for (const detach of this.detachers) {
      detach();
    }
    this.detachers = [];
    this.abortController?.abort();
    this.abortController = null;
  }
}

/** Global runtime instance */
export const runtime = new Runtime();
