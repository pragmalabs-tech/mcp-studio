import { create } from "zustand";
import type { RunState } from "./types";

export type { RunState };

interface TestState {
  studioMode: "normal" | "test";
  slicingState: { startIndex: number; startedAt: string } | null;
  runState: RunState | null;
  /** Set by external triggers (e.g. remote API) to request a test run by id. */
  pendingTestId: string | null;
  setStudioMode: (mode: "normal" | "test") => void;
  setSlicingState: (
    state: { startIndex: number; startedAt: string } | null,
  ) => void;
  setRunState: (next: RunState | null) => void;
  patchRunState: (patch: Partial<RunState>) => void;
  triggerTest: (testId: string) => void;
  clearPendingTest: () => void;
}

export const useTestStore = create<TestState>((set) => ({
  studioMode: "normal",
  slicingState: null,
  runState: null,
  pendingTestId: null,
  setStudioMode: (mode) => set({ studioMode: mode }),
  setSlicingState: (state) => set({ slicingState: state }),
  setRunState: (next) => set({ runState: next }),
  patchRunState: (patch) =>
    set((s) => ({
      runState: s.runState ? { ...s.runState, ...patch } : null,
    })),
  triggerTest: (testId) => set({ pendingTestId: testId }),
  clearPendingTest: () => set({ pendingTestId: null }),
}));
