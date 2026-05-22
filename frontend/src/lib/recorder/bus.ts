import type { Action } from "@/lib/action/types";
import type { RecordedAction, Session, SetupConfig } from "./schema";
import { SCHEMA_VERSION } from "./schema";

type Mode = "idle" | "recording";
type Listener = (mode: Mode) => void;
type ActionListener = (entry: RecordedAction) => void;

const STUDIO_VERSION = "0.2.2";

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

class Recorder {
  private _mode: Mode = "idle";
  private _suspended = false;
  private startedAt = 0;
  private buffer: RecordedAction[] = [];
  private setupSnapshot: SetupConfig | null = null;
  private listeners = new Set<Listener>();
  private actionListeners = new Set<ActionListener>();

  get mode(): Mode {
    return this._mode;
  }

  /** Returns a snapshot copy of the current buffer. */
  snapshot(): RecordedAction[] {
    return this.buffer.slice();
  }

  /** Index into the live buffer — use as start/end markers when slicing. */
  markIndex(): number {
    return this.buffer.length;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fires after each action is recorded. */
  onAction(listener: ActionListener): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  private notify() {
    for (const l of this.listeners) l(this._mode);
  }

  start(setup: SetupConfig): void {
    this.startedAt = nowMs();
    this.buffer = [];
    this.setupSnapshot = setup;
    this._mode = "recording";
    this.notify();
  }

  /** Record an action (call this after action completes to capture result) */
  record(action: Action): void {
    const relMs = nowMs() - this.startedAt;
    const entry: RecordedAction = {
      relMs,
      action: action.toJSON(), // toJSON() includes result if present
    };

    // Only persist when recording AND not suspended
    if (this._mode === "recording" && !this._suspended) {
      this.buffer.push(entry);
    }

    // Always fire listeners (for live observation)
    for (const l of this.actionListeners) l(entry);
  }

  /** Pause buffer persistence without resetting state. */
  suspend(): void {
    this._suspended = true;
  }

  resume(): void {
    this._suspended = false;
  }

  /**
   * Build a Session over a slice `[startIndex, endIndex)` of the buffer.
   */
  serializeRange(startIndex: number, endIndex?: number): Session {
    const start = Math.max(0, Math.min(startIndex, this.buffer.length));
    const end = Math.max(
      start,
      Math.min(endIndex ?? this.buffer.length, this.buffer.length),
    );
    const raw = this.buffer.slice(start, end);

    // Normalize relMs so the first action in the slice is t=0
    const offset = raw.length > 0 ? raw[0].relMs : 0;
    const slice = raw.map((entry) => ({
      ...entry,
      relMs: entry.relMs - offset,
    }));

    const setup = this.setupSnapshot ?? { url: "" };

    return {
      version: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      studioVersion: STUDIO_VERSION,
      setup,
      actions: slice,
    };
  }

  /**
   * Build a Session from the current buffer without resetting state.
   */
  serialize(): Session {
    const setup = this.setupSnapshot ?? { url: "" };
    return {
      version: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      studioVersion: STUDIO_VERSION,
      setup,
      actions: this.buffer,
    };
  }

  stop(): Session {
    const session = this.serialize();
    this.buffer = [];
    this.setupSnapshot = null;
    this._mode = "idle";
    this.notify();
    return session;
  }

  // Backward compatibility stub - old code may call this
  // We ignore these events for now (only recording Actions)
  emit(_entry: any): void {
    // No-op: old event format not used anymore
  }

  // Backward compatibility stub
  onEmit(_listener: any): () => void {
    // Return no-op unsubscribe
    return () => {};
  }

  // Backward compatibility stub
  setWidget(_widget: any): void {
    // No-op: old API not used anymore
  }
}

export const recorder = new Recorder();

export type { Mode };
