import type { ActionKind } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";

/** Tailwind text color per Action kind. Used by both the timeline blocks
 *  in `<TestResultPlayer />` and the rows in the History/Tests/Reports
 *  drawers. Add a row here when adding a new kind to the schema. */
export const KIND_COLOR: Record<ActionKind, string> = {
  [KIND.SIDEBAR_SELECT]: "text-sky-400",
  [KIND.EDITOR_SET_ARGS]: "text-amber-400",
  [KIND.CONFIG_UPDATE]: "text-violet-400",
  [KIND.AUTH_UPDATE]: "text-violet-400",
  [KIND.MCP_REQUEST]: "text-emerald-400",
  [KIND.MCP_RESPONSE]: "text-emerald-300/70",
  [KIND.MCP_NOTIFICATION]: "text-emerald-200/70",
  [KIND.WIDGET_RENDER]: "text-fuchsia-400",
  [KIND.WIDGET_RENDER_COMPLETE]: "text-fuchsia-300/70",
  [KIND.WIDGET_MOCK_SET]: "text-fuchsia-300",
  [KIND.WIDGET_INTENT]: "text-pink-400",
  [KIND.WIDGET_DOM_CLICK]: "text-orange-400",
  [KIND.WIDGET_DOM_INPUT]: "text-orange-300",
  [KIND.WIDGET_DOM_CHANGE]: "text-orange-300",
  [KIND.WIDGET_DOM_SUBMIT]: "text-orange-400",
  [KIND.WIDGET_DOM_KEYDOWN]: "text-yellow-400",
  [KIND.CSP_VIOLATION]: "text-red-400",
  [KIND.CUE_ASSERT]: "text-cyan-400",
  [KIND.CUE_WAIT]: "text-cyan-300/70",
  [KIND.CUE_NOTIFY]: "text-cyan-300",
  [KIND.CUE_EXPECT_INBOUND]: "text-cyan-300/70",
  [KIND.CUE_WIDGET_OPEN]: "text-fuchsia-400",
};

/** Background fill (lower opacity) for timeline blocks. Same hue palette
 *  as KIND_COLOR but as bg-* utilities so the block shape is visible. */
export const KIND_BG: Record<ActionKind, string> = {
  [KIND.SIDEBAR_SELECT]: "bg-sky-400/70",
  [KIND.EDITOR_SET_ARGS]: "bg-amber-400/70",
  [KIND.CONFIG_UPDATE]: "bg-violet-400/70",
  [KIND.AUTH_UPDATE]: "bg-violet-400/70",
  [KIND.MCP_REQUEST]: "bg-emerald-400/70",
  [KIND.MCP_RESPONSE]: "bg-emerald-300/40",
  [KIND.MCP_NOTIFICATION]: "bg-emerald-200/40",
  [KIND.WIDGET_RENDER]: "bg-fuchsia-400/70",
  [KIND.WIDGET_RENDER_COMPLETE]: "bg-fuchsia-300/40",
  [KIND.WIDGET_MOCK_SET]: "bg-fuchsia-300/70",
  [KIND.WIDGET_INTENT]: "bg-pink-400/70",
  [KIND.WIDGET_DOM_CLICK]: "bg-orange-400/70",
  [KIND.WIDGET_DOM_INPUT]: "bg-orange-300/70",
  [KIND.WIDGET_DOM_CHANGE]: "bg-orange-300/70",
  [KIND.WIDGET_DOM_SUBMIT]: "bg-orange-400/70",
  [KIND.WIDGET_DOM_KEYDOWN]: "bg-yellow-400/70",
  [KIND.CSP_VIOLATION]: "bg-red-400/70",
  [KIND.CUE_ASSERT]: "bg-cyan-400/70",
  [KIND.CUE_WAIT]: "bg-cyan-300/40",
  [KIND.CUE_NOTIFY]: "bg-cyan-300/70",
  [KIND.CUE_EXPECT_INBOUND]: "bg-cyan-300/40",
  [KIND.CUE_WIDGET_OPEN]: "bg-fuchsia-400/70",
};
