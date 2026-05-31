import { create } from "zustand";
import type { RunState } from "./types";

export type { RunState };

interface TestState {
  studioMode: "normal" | "test";
  slicingState: { startIndex: number; startedAt: string } | null;
  runState: RunState | null;
  setStudioMode: (mode: "normal" | "test") => void;
  setSlicingState: (
    state: { startIndex: number; startedAt: string } | null,
  ) => void;
  setRunState: (next: RunState | null) => void;
  patchRunState: (patch: Partial<RunState>) => void;
}

export const useTestStore = create<TestState>((set) => ({
  studioMode: "normal",
  slicingState: null,
  runState: null,
  setStudioMode: (mode) => set({ studioMode: mode }),
  setSlicingState: (state) => set({ slicingState: state }),
  setRunState: (next) => set({ runState: next }),
  patchRunState: (patch) =>
    set((s) => ({
      runState: s.runState ? { ...s.runState, ...patch } : null,
    })),
}));
