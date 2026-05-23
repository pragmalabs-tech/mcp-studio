export const SCHEMA_VERSION = 2 as const;

/** Snapshot of the studio's setup when recording started — minimal because
 *  replay reuses the live studio config; we only carry what's needed to
 *  display "where this test was captured". */
export interface SetupConfig {
  url: string;
  theme?: string;
  locale?: string;
}

/** A recorded Action plus its offset from the start of the recording. */
export interface RecordedAction {
  relMs: number;
  // `action.toJSON()` is a discriminated blob; the dialog narrows on `type`.
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
}

export interface Session {
  version: typeof SCHEMA_VERSION;
  capturedAt: string;
  studioVersion: string;
  setup: SetupConfig;
  actions: RecordedAction[];
}
