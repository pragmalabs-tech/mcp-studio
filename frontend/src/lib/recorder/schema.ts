import type { StateChange } from "@/lib/state/types";

/**
 * Session schema version.
 *
 *   - v1: initial event-based recording (retired).
 *   - v2: Action+StateChange shape; tool response lived directly at
 *         `RecordedAction.action.result.data`.
 *   - v3: tool response is wrapped under `data.tool` and joined by
 *         widget outcome fields (`data.widget`, `data.widgetId`,
 *         `data.snapshot`). State gains a `widgets` slice for
 *         per-widget renderCount. See `migrateSession` for the v2→v3
 *         upgrade — older sessions get their `data` wrapped lazily on
 *         load so existing assertions keep working.
 */
export const SCHEMA_VERSION = 3 as const;

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

/**
 * Upgrade a saved session in place. Today only v2→v3 is handled: wrap
 * each TOOL_CALL action's `result.data` (raw tool response) under
 * `data.tool` and stub in the new widget fields. Older versions or
 * already-current sessions pass through untouched. Idempotent.
 */
export function migrateSession(session: Session): Session {
  // Sessions written prior to the version-bump are not literally typed
  // as `typeof SCHEMA_VERSION`, but localStorage round-trips them as
  // plain `number`. Read once and dispatch.
  const version = (session as { version?: number }).version ?? 0;
  if (version >= SCHEMA_VERSION) return session;

  if (version === 2) {
    return {
      ...session,
      version: SCHEMA_VERSION,
      actions: session.actions.map((entry) => {
        if (entry.action.type !== "TOOL_CALL") return entry;
        const result = entry.action.result;
        if (!result) return entry;
        // Skip when an earlier load already wrapped this entry.
        if (
          result.data !== null &&
          typeof result.data === "object" &&
          "tool" in (result.data as object) &&
          "widget" in (result.data as object)
        ) {
          return entry;
        }
        return {
          ...entry,
          action: {
            ...entry.action,
            result: {
              ...result,
              data: {
                tool: result.data,
                widget: null,
                widgetId: null,
                snapshot: null,
              },
            },
          },
        };
      }),
    };
  }

  return session;
}
