import { create } from "zustand";
import type { RunState } from "./types";

export type { RunState };

interface TestState {
  studioMode: "normal" | "test";
  slicingState: { startIndex: number; startedAt: string } | null;
  runState: RunState | null;
  /** Set by external triggers (e.g. remote API) to request a test run. */
  pendingTest: { testId: string; jobId: string } | null;
  setStudioMode: (mode: "normal" | "test") => void;
  setSlicingState: (
    state: { startIndex: number; startedAt: string } | null,
  ) => void;
  setRunState: (next: RunState | null) => void;
  patchRunState: (patch: Partial<RunState>) => void;
  triggerTest: (testId: string, jobId: string) => void;
  clearPendingTest: () => void;
}

export const useTestStore = create<TestState>((set) => ({
  studioMode: "normal",
  slicingState: null,
  runState: null,
  pendingTest: null,
  setStudioMode: (mode) => set({ studioMode: mode }),
  setSlicingState: (state) => set({ slicingState: state }),
  setRunState: (next) => set({ runState: next }),
  patchRunState: (patch) =>
    set((s) => ({
      runState: s.runState ? { ...s.runState, ...patch } : null,
    })),
  triggerTest: (testId, jobId) => set({ pendingTest: { testId, jobId } }),
  clearPendingTest: () => set({ pendingTest: null }),
}));
