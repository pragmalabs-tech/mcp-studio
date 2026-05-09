import { describe, expect, it } from "vitest";
import { createArtifactCollector } from "./artifacts";
import type { Recorded } from "@/lib/recorder/schema";

const action = (i: number): Recorded => ({
  relMs: i,
  kind: "sidebar.select",
  selection: { type: "tool", name: `t${i}` },
});

describe("ArtifactCollector", () => {
  it("records the last 5 actions as the failure context window", () => {
    const c = createArtifactCollector();
    for (let i = 0; i < 8; i++) c.rememberAction(action(i));
    c.recordFailure(7, { html: "<body/>", errors: [] });
    const a = c.finalize();
    expect(a.failures[7].contextWindow).toHaveLength(5);
    if (a.failures[7].contextWindow[0].kind === "sidebar.select") {
      expect(a.failures[7].contextWindow[0].selection.name).toBe("t3");
    }
  });

  it("records snapshot html and errors", () => {
    const c = createArtifactCollector();
    c.rememberAction(action(0));
    c.recordFailure(0, { html: "<div>hi</div>", errors: ["boom"] });
    const a = c.finalize();
    expect(a.failures[0].domSnapshot).toBe("<div>hi</div>");
    expect(a.failures[0].errors).toEqual(["boom"]);
  });

  it("falls back to placeholder when snapshot is null", () => {
    const c = createArtifactCollector();
    c.recordFailure(0, null);
    const a = c.finalize();
    expect(a.failures[0].domSnapshot).toBe("");
    expect(a.failures[0].errors).toEqual(["snapshot unavailable"]);
  });

  it("only stores entries for failed step indices", () => {
    const c = createArtifactCollector();
    c.recordFailure(2, { html: "x", errors: [] });
    c.recordFailure(5, { html: "y", errors: [] });
    const a = c.finalize();
    expect(Object.keys(a.failures).sort()).toEqual(["2", "5"]);
  });

  it("recordPreview stores html keyed by step index", () => {
    const c = createArtifactCollector();
    c.recordPreview(4, { html: "<body>rendered</body>", errors: [] });
    const a = c.finalize();
    expect(a.previews[4].domSnapshot).toBe("<body>rendered</body>");
  });

  it("recordPreview ignores empty / null snapshots", () => {
    const c = createArtifactCollector();
    c.recordPreview(0, null);
    c.recordPreview(1, { html: "", errors: [] });
    const a = c.finalize();
    expect(a.previews).toEqual({});
  });
});
