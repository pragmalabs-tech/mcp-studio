import type { Event } from "@/lib/event/types";

// Main state interface
export interface State {
  tools: Record<string, ToolState>;
  resources: Record<string, ResourceState>;
  network: NetworkState;
}

// Tool state
export interface ToolState {
  callCount: number;
  calls: ToolCall[];
  lastResult?: unknown;
  lastError?: { message: string };
}

export interface ToolCall {
  requestId: number;
  params: unknown;
  result?: unknown;
  error?: string;
  timestamp: number;
}

// Resource state
export interface ResourceState {
  readCount: number;
  reads: ResourceRead[];
  lastResult?: unknown;
  lastError?: { message: string };
}

export interface ResourceRead {
  requestId: number;
  result?: unknown;
  error?: string;
  timestamp: number;
}

// Network state
export interface NetworkState {
  requestCount: number;
  responseCount: number;
  errorCount: number;
}

// Create initial state
export function createInitialState(): State {
  return {
    tools: {},
    resources: {},
    network: {
      requestCount: 0,
      responseCount: 0,
      errorCount: 0,
    },
  };
}

// Apply single event to state
export function applyEvent(state: State, event: Event): State {
  return event.apply(state);
}

// Apply multiple events to state
export function applyEvents(state: State, events: Event[]): State {
  return events.reduce((s, e) => applyEvent(s, e), state);
}
