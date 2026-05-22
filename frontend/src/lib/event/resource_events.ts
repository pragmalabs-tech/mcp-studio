import { Event } from "./types";
import type { State } from "@/lib/state/types";

export class ResourceReadRequestedEvent extends Event<{
  requestId: number;
  uri: string;
}> {
  constructor(data: { requestId: number; uri: string }) {
    super("RESOURCE_READ_REQUESTED", data);
  }

  apply(state: State): State {
    const { requestId, uri } = this.data;
    const resourceState = state.resources[uri] || {
      readCount: 0,
      reads: [],
    };

    return {
      ...state,
      resources: {
        ...state.resources,
        [uri]: {
          ...resourceState,
          readCount: resourceState.readCount + 1,
          reads: [
            ...resourceState.reads,
            {
              requestId,
              timestamp: Date.now(),
            },
          ],
        },
      },
      network: {
        ...state.network,
        requestCount: state.network.requestCount + 1,
      },
    };
  }
}

export class ResourceReadCompletedEvent extends Event<{
  requestId: number;
  uri: string;
  result: unknown;
}> {
  constructor(data: { requestId: number; uri: string; result: unknown }) {
    super("RESOURCE_READ_COMPLETED", data);
  }

  apply(state: State): State {
    const { requestId, uri, result } = this.data;
    const resourceState = state.resources[uri];
    if (!resourceState) return state;

    const updatedReads = resourceState.reads.map((read) =>
      read.requestId === requestId ? { ...read, result } : read
    );

    return {
      ...state,
      resources: {
        ...state.resources,
        [uri]: {
          ...resourceState,
          reads: updatedReads,
          lastResult: result,
        },
      },
      network: {
        ...state.network,
        responseCount: state.network.responseCount + 1,
      },
    };
  }
}

export class ResourceReadFailedEvent extends Event<{
  requestId: number;
  uri: string;
  error: string;
}> {
  constructor(data: { requestId: number; uri: string; error: string }) {
    super("RESOURCE_READ_FAILED", data);
  }

  apply(state: State): State {
    const { requestId, uri, error } = this.data;
    const resourceState = state.resources[uri];
    if (!resourceState) return state;

    const updatedReads = resourceState.reads.map((read) =>
      read.requestId === requestId ? { ...read, error } : read
    );

    return {
      ...state,
      resources: {
        ...state.resources,
        [uri]: {
          ...resourceState,
          reads: updatedReads,
          lastError: { message: error },
        },
      },
      network: {
        ...state.network,
        errorCount: state.network.errorCount + 1,
      },
    };
  }
}
