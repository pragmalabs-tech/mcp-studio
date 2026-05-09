import type { SelectorChain } from "./schema";

export const BRIDGE_MARK = "__recorder" as const;

export type BridgeMessage =
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

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [k: string]: unknown })[BRIDGE_MARK] === true &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}
