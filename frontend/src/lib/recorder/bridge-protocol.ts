import type { SelectorChain, WidgetDomAction } from "./schema";

export const BRIDGE_MARK = "__recorder" as const;

/**
 * Outbound: legacy capture events (no `op` tag, distinguished by `kind`).
 * Kept untagged so existing recorder bridge versions keep working.
 */
export type BridgeCaptureMessage =
  | {
      __recorder: true;
      kind: "widget.dom.click";
      selectors: SelectorChain;
      mutated: boolean;
    }
  | {
      __recorder: true;
      kind: "widget.dom.input";
      selectors: SelectorChain;
      value: string;
      inputType: string;
      mutated: boolean;
    }
  | {
      __recorder: true;
      kind: "widget.dom.change";
      selectors: SelectorChain;
      value: string;
      mutated: boolean;
    }
  | {
      __recorder: true;
      kind: "widget.dom.submit";
      selectors: SelectorChain;
      mutated: boolean;
    }
  | {
      __recorder: true;
      kind: "widget.dom.keydown";
      selectors: SelectorChain;
      key: string;
      code: string;
      mods: number;
      mutated: boolean;
    };

/** Outbound: render-complete + ack + snapshot.result (op-tagged). */
export type BridgeOutboundOp =
  | {
      __recorder: true;
      op: "render.complete";
      bodyChars: number;
      hasRuntimeErrors: boolean;
      handshakeOk: boolean;
      renderDurationMs: number;
    }
  | {
      __recorder: true;
      op: "ack";
      id: number;
      ok: boolean;
      mutated?: boolean;
      reason?: string;
    }
  | {
      __recorder: true;
      op: "snapshot.result";
      id: number;
      html: string;
      errors: string[];
    };

/** Inbound: host → iframe replay commands. */
export type BridgeInboundOp =
  | { __recorder: true; op: "dispatch"; id: number; action: WidgetDomAction }
  | { __recorder: true; op: "ping"; id: number }
  | { __recorder: true; op: "snapshot"; id: number };

export type BridgeMessage =
  | BridgeCaptureMessage
  | BridgeOutboundOp
  | BridgeInboundOp;

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [k: string]: unknown })[BRIDGE_MARK] === true
  );
}

/** Outbound capture event (the legacy non-op case). */
export function isCaptureMessage(
  value: BridgeMessage,
): value is BridgeCaptureMessage {
  return (
    !("op" in value) && typeof (value as { kind?: unknown }).kind === "string"
  );
}
