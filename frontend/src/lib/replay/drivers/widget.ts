import type {
  Action,
  ActionKind,
  WidgetDomAction,
} from "@/lib/recorder/schema";
import type { Driver, DriveOutcome } from "./types";
import { timeoutFor } from "@/lib/replay/timing";

const KINDS: ActionKind[] = [
  "widget.render",
  "widget.dom.click",
  "widget.dom.input",
  "widget.dom.change",
  "widget.dom.submit",
  "widget.dom.keydown",
];

const WIDGET_DOM_KINDS: ActionKind[] = [
  "widget.dom.click",
  "widget.dom.input",
  "widget.dom.change",
  "widget.dom.submit",
  "widget.dom.keydown",
];

export const widgetDriver: Driver<Action> = {
  kinds: KINDS,
  async drive(action, ctx): Promise<DriveOutcome> {
    const t0 = performance.now();

    if (action.kind === "widget.render") {
      // The widget render is a side effect of mcp.request → execute(); the
      // Player just waits for the next render.complete from the iframe.
      try {
        const r = await ctx.bridge.awaitRenderComplete(
          timeoutFor("widget.render"),
        );
        return {
          ok: true,
          observation: r,
          durationMs: performance.now() - t0,
        };
      } catch (err) {
        return {
          ok: false,
          reason: (err as Error).message,
          durationMs: performance.now() - t0,
        };
      }
    }

    if (WIDGET_DOM_KINDS.includes(action.kind)) {
      const ack = await ctx.bridge.dispatch(
        action as WidgetDomAction,
        timeoutFor(action.kind),
      );
      return {
        ok: ack.ok,
        observation: ack,
        reason: ack.ok ? undefined : (ack.reason ?? "bridge-fail"),
        durationMs: performance.now() - t0,
      } as DriveOutcome;
    }

    return { ok: false, reason: "unsupported-kind", durationMs: 0 };
  },
};
