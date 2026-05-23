import type { StateChange } from "@/lib/state/types";

export const SCHEMA_VERSION = 2 as const;

/**
 * Setup metadata captured at record-time — purely informational. NOT
 * compared on replay; the studio's live config wins. Add a field here
 * only when it's context that helps a human read the test; if it's
 * something the verifier should check, it belongs in State / Action.
 */
export interface SetupConfig {
  url: string;
  theme?: string;
  locale?: string;
}

/**
 * A recorded Action plus its offset from the start of the recording.
 *
 *   - `action.result` — the response/error data, used by `action.verify`.
 *   - `stateChange` — the counter delta, used by `verifyState`.
 *
 * Both are independent: result mismatches and counter mismatches surface
 * as separate assertions in the replay dialog.
 */
export interface RecordedAction {
  relMs: number;
  action: {
    id: string;
    type: string;
    data: any;
    timestamp: number;
    result?: {
      success: boolean;
      data?: unknown;
      error?: { message: string };
    };
  };
  stateChange?: StateChange;
}

export interface Session {
  version: typeof SCHEMA_VERSION;
  capturedAt: string;
  studioVersion: string;
  setup: SetupConfig;
  actions: RecordedAction[];
}
