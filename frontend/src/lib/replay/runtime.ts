import type { Recorded } from "@/lib/recorder/schema";
import type { RunResult, StepResult } from "./player";

export interface ProgressSnapshot {
  testName: string;
  testDescription?: string;
  total: number;
  index: number;
  current: Recorded | null;
  lastStep?: StepResult;
  status: "running" | "done";
  result?: RunResult;
}

type Listener = (snapshot: ProgressSnapshot | null) => void;

class Runtime {
  private snapshot: ProgressSnapshot | null = null;
  private listeners = new Set<Listener>();
  private abortFn: (() => void) | null = null;

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
    abort: () => void,
  ) {
    this.snapshot = {
      testName: name,
      testDescription: description,
      total,
      index: 0,
      current: null,
      status: "running",
    };
    this.abortFn = abort;
    this.notify();
  }

  step(index: number, current: Recorded, lastStep: StepResult) {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, index: index + 1, current, lastStep };
    this.notify();
  }

  finish(result: RunResult) {
    this.abortFn = null;
    this.snapshot = this.snapshot
      ? { ...this.snapshot, status: "done", result }
      : null;
    this.notify();
  }

  /** Clear the current snapshot (after the user dismisses the result). */
  clear() {
    this.snapshot = null;
    this.abortFn = null;
    this.notify();
  }

  abort() {
    this.abortFn?.();
  }

  private notify() {
    for (const l of this.listeners) l(this.snapshot);
  }
}

export const runtime = new Runtime();
