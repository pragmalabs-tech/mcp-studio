import type { Recorded } from "@/lib/recorder/schema";
import type { SnapshotResult } from "./bridge-client";

export interface FailureArtifact {
  domSnapshot: string;
  errors: string[];
  contextWindow: Recorded[];
}

export interface PreviewArtifact {
  domSnapshot: string;
}

export interface ReplayArtifacts {
  /** Keyed by step index. Failures get full context. */
  failures: Record<number, FailureArtifact>;
  /** Keyed by step index. Lightweight snapshots for visual proof on success
   *  steps that produced visible output (e.g. widget.render). */
  previews: Record<number, PreviewArtifact>;
}

const CONTEXT_WINDOW_SIZE = 5;

export interface ArtifactCollector {
  rememberAction(action: Recorded): void;
  recordFailure(stepIndex: number, snapshot: SnapshotResult | null): void;
  recordPreview(stepIndex: number, snapshot: SnapshotResult | null): void;
  finalize(): ReplayArtifacts;
}

export function createArtifactCollector(): ArtifactCollector {
  const failures: Record<number, FailureArtifact> = {};
  const previews: Record<number, PreviewArtifact> = {};
  const recent: Recorded[] = [];

  return {
    rememberAction(action) {
      recent.push(action);
      if (recent.length > CONTEXT_WINDOW_SIZE * 2) {
        recent.splice(0, recent.length - CONTEXT_WINDOW_SIZE * 2);
      }
    },
    recordFailure(stepIndex, snapshot) {
      failures[stepIndex] = {
        domSnapshot: snapshot?.html ?? "",
        errors: snapshot?.errors ?? ["snapshot unavailable"],
        contextWindow: recent.slice(-CONTEXT_WINDOW_SIZE),
      };
    },
    recordPreview(stepIndex, snapshot) {
      if (!snapshot || !snapshot.html) return;
      previews[stepIndex] = { domSnapshot: snapshot.html };
    },
    finalize() {
      return { failures, previews };
    },
  };
}
