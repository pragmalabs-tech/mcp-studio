import {
  REDACTED_TOKEN,
  SCHEMA_VERSION,
  type Action,
  type AuthBlock,
  type Recorded,
  type Session,
  type SessionWidget,
  type SetupConfig,
  type SetupConnect,
} from "./schema";

type Mode = "idle" | "recording";
type Listener = (mode: Mode) => void;
type EmitListener = (entry: Recorded) => void;

const STUDIO_VERSION = "0.1.0";

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function redactAuth(auth: AuthBlock): AuthBlock {
  if (auth.method === "oauth" || auth.method === "bearer") {
    return { method: auth.method, token: auth.token ? REDACTED_TOKEN : "" };
  }
  return auth;
}

function redactSetupConnect(connect: SetupConnect): SetupConnect {
  return { url: connect.url, auth: redactAuth(connect.auth) };
}

function redactAuthPatch(patch: Partial<AuthBlock>): Partial<AuthBlock> {
  if (!("method" in patch)) {
    if (
      "token" in patch &&
      typeof (patch as { token?: string }).token === "string"
    ) {
      return {
        ...(patch as object),
        token: REDACTED_TOKEN,
      } as Partial<AuthBlock>;
    }
    return patch;
  }
  if (patch.method === "oauth" || patch.method === "bearer") {
    return {
      method: patch.method,
      token: (patch as { token?: string }).token ? REDACTED_TOKEN : "",
    } as Partial<AuthBlock>;
  }
  return patch;
}

function redactRecorded(entry: Recorded): Recorded {
  if (entry.kind !== "auth.update") return entry;
  return { ...entry, patch: redactAuthPatch(entry.patch) };
}

class Recorder {
  private _mode: Mode = "idle";
  private startedAt = 0;
  private buffer: Recorded[] = [];
  private setupSnapshot: { connect: SetupConnect; config: SetupConfig } | null =
    null;
  private widgetSnapshot: SessionWidget | null = null;
  private listeners = new Set<Listener>();
  private emitListeners = new Set<EmitListener>();

  get mode(): Mode {
    return this._mode;
  }

  /** Returns a snapshot copy of the current timeline buffer. */
  snapshot(): Recorded[] {
    return this.buffer.slice();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fires after each emit while recording. Used by live UIs. */
  onEmit(listener: EmitListener): () => void {
    this.emitListeners.add(listener);
    return () => this.emitListeners.delete(listener);
  }

  private notify() {
    for (const l of this.listeners) l(this._mode);
  }

  start(snapshot: { connect: SetupConnect; config: SetupConfig }): void {
    this.startedAt = nowMs();
    this.buffer = [];
    this.widgetSnapshot = null;
    this.setupSnapshot = snapshot;
    this._mode = "recording";
    this.notify();
  }

  emit(action: Action): void {
    if (this._mode !== "recording") return;
    const relMs = nowMs() - this.startedAt;
    const entry = { relMs, ...action } as Recorded;
    this.buffer.push(entry);
    for (const l of this.emitListeners) l(entry);
  }

  setWidget(widget: SessionWidget): void {
    if (this._mode !== "recording") return;
    this.widgetSnapshot = widget;
  }

  /**
   * Build a Session document from the current buffer without resetting state.
   * Use for "export running session" UX. `stop()` calls this then resets.
   */
  serialize(): Session {
    const setup = this.setupSnapshot ?? {
      connect: { url: "", auth: { method: "bearer", token: "" } },
      config: {
        platform: "claude",
        theme: "light",
        displayMode: "inline",
        locale: "en-US",
        viewport: { preset: "desktop" },
        strictMode: false,
      },
    };
    return {
      version: SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      studioVersion: STUDIO_VERSION,
      setup: {
        connect: redactSetupConnect(setup.connect),
        config: setup.config,
      },
      ...(this.widgetSnapshot ? { widget: this.widgetSnapshot } : {}),
      timeline: this.buffer.map(redactRecorded),
    };
  }

  stop(): Session {
    const session = this.serialize();
    this.buffer = [];
    this.setupSnapshot = null;
    this.widgetSnapshot = null;
    this._mode = "idle";
    this.notify();
    return session;
  }
}

export const recorder = new Recorder();

export type { Mode };
