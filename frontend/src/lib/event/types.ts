/**
 * Event is a PURE OBSERVATION. Not interactive — no run() method.
 *
 * DIFFERENT from the retired Event pattern (~earlier commit history):
 *   - Retired: Action.execute() RETURNED Event[] for state derivation. One
 *     consumer, pure scaffolding. Deleted.
 *   - This Event: EMITTED by side-effect sources (api.mcpCall, iframe mount,
 *     future server push) and ROUTED by the bus to whichever Action is
 *     currently active. Multiple consumers: action.events recording, replay
 *     assertion, replay-advance gating, future state derivation.
 *
 * Do not give Event a run() method or have an Action emit one explicitly —
 * that collapses Event back into Action and reopens the retired pattern.
 */

export interface EventResult {
  success: boolean;
  data?: unknown;
  error?: { message: string };
}

export abstract class Event<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly timestamp: number;
  readonly data: T;
  result?: EventResult;

  constructor(type: string, data: T, result?: EventResult) {
    this.id = crypto.randomUUID();
    this.type = type;
    this.timestamp = 0;
    this.data = data;
    if (result) this.result = result;
  }

  toJSON(): object {
    const json: Record<string, unknown> = {
      id: this.id,
      type: this.type,
      data: this.data,
      timestamp: this.timestamp,
    };
    if (this.result) json.result = this.result;
    return json;
  }
}
