// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/studio/stores/widget-store", () => {
  const state: Record<string, unknown> = {
    logAction: vi.fn(),
    _iframeRef: null as { contentDocument: Document | null } | null,
    openClick: null,
  };
  return {
    useWidgetStore: {
      getState: () => state,
      setState: (patch: object | ((s: object) => object)) => {
        const next = typeof patch === "function" ? patch(state) : patch;
        Object.assign(state, next);
      },
    },
  };
});

import { WidgetCanvasClickAction } from "./widget_canvas_click";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import type { CanvasLocator } from "./utils/widget-interaction-capture/types";

function docWith(bodyHtml: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${bodyHtml}</body></html>`,
    "text/html",
  );
}

function mountDoc(doc: Document) {
  const s = useWidgetStore.getState() as unknown as Record<string, unknown>;
  s.logAction = vi.fn();
  s._iframeRef = { contentDocument: doc } as unknown as Record<string, unknown>;
  s.openClick = null;
}

const loc = (over: Partial<CanvasLocator> = {}): CanvasLocator => ({
  selector: "canvas.board",
  index: 0,
  total: 1,
  ...over,
});

describe("WidgetCanvasClickAction", () => {
  beforeEach(() => {
    mountDoc(docWith(""));
  });

  it("sets success=false when the iframe isn't mounted", async () => {
    const s = useWidgetStore.getState() as unknown as Record<string, unknown>;
    s._iframeRef = null;
    const action = new WidgetCanvasClickAction("w1", loc(), 0.5, 0.5);
    await action.execute();
    expect(action.result?.success).toBe(false);
    expect(action.result?.error?.message).toBe("iframe not mounted");
  });

  it("sets success=false when no canvas can be resolved", async () => {
    mountDoc(docWith(`<div>no canvas here</div>`));
    const action = new WidgetCanvasClickAction("w1", loc(), 0.5, 0.5);
    await action.execute();
    expect(action.result?.success).toBe(false);
    expect(action.result?.error?.message).toBe("canvas not found");
  });

  it("resolves the canvas by unique selector and dispatches a tap", async () => {
    mountDoc(docWith(`<canvas class="board"></canvas>`));
    const doc = (
      useWidgetStore.getState() as unknown as {
        _iframeRef: { contentDocument: Document };
      }
    )._iframeRef.contentDocument;
    const canvas = doc.querySelector("canvas")!;
    const down = vi.fn();
    const up = vi.fn();
    const click = vi.fn();
    canvas.addEventListener("mousedown", down);
    canvas.addEventListener("mouseup", up);
    canvas.addEventListener("click", click);

    const action = new WidgetCanvasClickAction("w1", loc(), 0.5, 0.25);
    const settled = action.execute();
    action.close();
    await settled;

    expect(action.result?.success).toBe(true);
    const data = action.result?.data as { matchedSelector: string; nx: number };
    expect(data.matchedSelector).toBe("canvas.board");
    expect(data.nx).toBe(0.5);
    expect(down).toHaveBeenCalledOnce();
    expect(up).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it("falls back to the Nth canvas when the selector isn't unique", async () => {
    mountDoc(docWith(`<canvas class="c"></canvas><canvas class="c"></canvas>`));
    // selector matches 2 → not unique → index fallback (index 1 of total 2)
    const action = new WidgetCanvasClickAction(
      "w1",
      loc({ selector: "canvas.c", index: 1, total: 2 }),
      0.5,
      0.5,
    );
    const settled = action.execute();
    action.close();
    await settled;

    expect(action.result?.success).toBe(true);
    const data = action.result?.data as { matchedSelector: string };
    expect(data.matchedSelector).toBe("canvas#index=1");
  });

  it("falls back to the sole canvas when locator drifts", async () => {
    mountDoc(docWith(`<canvas class="renamed"></canvas>`));
    // selector misses and total mismatches, but there's exactly one canvas
    const action = new WidgetCanvasClickAction(
      "w1",
      loc({ selector: "canvas.board", index: 0, total: 3 }),
      0.5,
      0.5,
    );
    const settled = action.execute();
    action.close();
    await settled;

    expect(action.result?.success).toBe(true);
    const data = action.result?.data as { matchedSelector: string };
    expect(data.matchedSelector).toBe("canvas");
  });

  it("change() counts a click on the widget", async () => {
    mountDoc(docWith(`<canvas class="board"></canvas>`));
    const action = new WidgetCanvasClickAction("w1", loc(), 0.5, 0.5);
    const settled = action.execute();
    action.close();
    await settled;

    expect(action.change()).toEqual({
      widgets: { w1: { renderCount: 0, clickCount: 1 } },
    });
  });

  it("declares assertable points covering success, matched, errorMessage", () => {
    const keys = WidgetCanvasClickAction.assertablePoints.map((p) => p.key);
    expect(keys).toContain("success");
    expect(keys).toContain("matched");
    expect(keys).toContain("errorMessage");
  });
});
