// ── State ──

/**
 * The studio's compositional State — pure counters. Tracks "what happened
 * how many times" against the MCP surface; the actual response/error
 * payloads live on each `Action.result`, not here.
 *
 * Splitting it this way lets the assertion layer run two clean compares
 * per replay step:
 *   - `action.verify(recordedResult)` — did the response/error match?
 *   - `verifyState(recordedChange, () => action.change())` — did the
 *     state counters move the same way?
 */
export interface State {
  tools: Record<string, ToolState>;
  resources: Record<string, ResourceState>;
  network: NetworkState;
}

export interface ToolState {
  callCount: number;
}

export interface ResourceState {
  readCount: number;
}

export interface NetworkState {
  requestCount: number;
  responseCount: number;
  errorCount: number;
}

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

// ── StateChange ──

/** Sparse partial of `State` — the counter delta one action contributes. */
export type StateChange = Partial<State>;

/**
 * Reduce a `State` by merging in a `StateChange`. Tool/resource slices
 * replace atomically; `network` replaces wholesale.
 */
export function applyChange(state: State, change: StateChange): State {
  return {
    tools: change.tools ? { ...state.tools, ...change.tools } : state.tools,
    resources: change.resources
      ? { ...state.resources, ...change.resources }
      : state.resources,
    network: change.network ?? state.network,
  };
}
