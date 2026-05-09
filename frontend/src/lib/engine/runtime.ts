import type { Recorded } from "@/lib/recorder/schema";
import type { RunMode, RunResult, StepResult } from "./engine";

export interface ProgressSnapshot {
  testName: string;
  testDescription?: string;
  total: number;
  index: number;
  current: Recorded | null;
  lastStep?: StepResult;
  status: "running" | "done";
  result?: RunResult;
  mode: RunMode;
}

type Listener = (snapshot: ProgressSnapshot | null) => void;

class Runtime {
  private snapshot: ProgressSnapshot | null = null;
  private listeners = new Set<Listener>();
  private abortFn: (() => void) | null = null;
  private nextFn: (() => void) | null = null;
  private setModeFn: ((mode: RunMode) => void) | null = null;

  get current(): ProgressSnapshot | null {
    return this.snapshot;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  begin(
    name: string,
    description: string | undefined,
    total: number,
    initialMode: RunMode,
    handlers: {
      abort: () => void;
      next: () => void;
      setMode: (mode: RunMode) => void;
    },
  ) {
    this.snapshot = {
      testName: name,
      testDescription: description,
      total,
      index: 0,
      current: null,
      status: "running",
      mode: initialMode,
    };
    this.abortFn = handlers.abort;
    this.nextFn = handlers.next;
    this.setModeFn = handlers.setMode;
    this.notify();
  }

  step(index: number, current: Recorded, lastStep: StepResult) {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, index: index + 1, current, lastStep };
    this.notify();
  }

  finish(result: RunResult) {
    this.abortFn = null;
    this.nextFn = null;
    this.setModeFn = null;
    this.snapshot = this.snapshot
      ? { ...this.snapshot, status: "done", result }
      : null;
    this.notify();
  }

  /** Clear the current snapshot (after the user dismisses the result). */
  clear() {
    this.snapshot = null;
    this.abortFn = null;
    this.nextFn = null;
    this.setModeFn = null;
    this.notify();
  }

  abort() {
    this.abortFn?.();
  }

  next() {
    this.nextFn?.();
  }

  setMode(mode: RunMode) {
    this.setModeFn?.(mode);
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, mode };
      this.notify();
    }
  }

  private notify() {
    for (const l of this.listeners) l(this.snapshot);
  }
}

export const runtime = new Runtime();
