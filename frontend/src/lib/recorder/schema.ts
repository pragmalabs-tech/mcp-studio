import type { StateChange } from "@/lib/state/types";

/**
 * Session schema version stamped on every recording at save time.
 *
 * Studio is pre-1.0 — recordings older than the current SCHEMA_VERSION
 * are NOT migrated. If you bump this, expect existing test files on disk
 * to need re-recording. Keep the bump deliberate.
 */
export const SCHEMA_VERSION = 4 as const;

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
 *   - `action.events` — side-effect observations during the action's
 *     window (tools/call, widget/render, etc.). Reconstructed via
 *     `reconstructEvent`.
 *   - `stateChange` — the counter delta, used by `verifyState`.
 *
 * Result, events, and stateChange are independent: mismatches in each
 * surface as separate assertions in the replay dialog.
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
    events?: Array<{
      id: string;
      type: string;
      data: any;
      timestamp: number;
      result?: {
        success: boolean;
        data?: unknown;
        error?: { message: string };
      };
    }>;
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
