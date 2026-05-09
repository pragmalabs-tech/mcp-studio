import type { Action, ActionKind } from "@/lib/recorder/schema";
import { KIND } from "@/lib/recorder/kinds";
import type { DriveOutcome } from "./drivers/types";
import type { AckResult, RenderCompleteResult } from "./bridge-client";

export type AssertionResult =
  | { status: "pass"; info?: Record<string, unknown> }
  | { status: "fail"; reason: string; info?: Record<string, unknown> }
  | { status: "skip" };

export type Asserter<A extends Action = Action> = (
  action: A,
  outcome: DriveOutcome,
  observation: unknown,
) => AssertionResult;

const passThrough: Asserter = (_a, outcome) =>
  outcome.ok ? { status: "pass" } : { status: "fail", reason: outcome.reason };

function ackPass(
  outcome: DriveOutcome,
  requireMutation: boolean,
): AssertionResult {
  if (!outcome.ok) {
    return { status: "fail", reason: outcome.reason };
  }
  const ack = outcome.observation as AckResult | undefined;
  if (!ack) return { status: "fail", reason: "no ack" };
  if (!ack.ok) {
    return { status: "fail", reason: ack.reason ?? "bridge ack ok=false" };
  }
  if (requireMutation && ack.mutated === false) {
    return {
      status: "fail",
      reason: "DOM did not mutate after dispatch",
      info: { mutated: false },
    };
  }
  return { status: "pass", info: { mutated: ack.mutated } };
}

const ASSERTERS: { [K in ActionKind]?: Asserter } = {
  [KIND.MCP_REQUEST]: (action, outcome, observation) => {
    if (action.kind !== KIND.MCP_REQUEST)
      return passThrough(action, outcome, observation);
    if (!outcome.ok) {
      return { status: "fail", reason: outcome.reason };
    }
    const obs = (outcome.observation ?? observation) as
      | { error?: { message: string }; result?: unknown; durationMs?: number }
      | undefined;
    if (!obs) {
      return { status: "fail", reason: "no response observation" };
    }
    if (obs.error) {
      return {
        status: "fail",
        reason: obs.error.message,
        info: { method: action.method },
      };
    }
    return {
      status: "pass",
      info: { method: action.method, durationMs: obs.durationMs },
    };
  },
  [KIND.WIDGET_RENDER]: (_a, outcome) => {
    if (!outcome.ok) {
      return { status: "fail", reason: outcome.reason };
    }
    const r = outcome.observation as RenderCompleteResult | undefined;
    if (!r) {
      return { status: "fail", reason: "no render.complete observation" };
    }
    if (r.hasRuntimeErrors) {
      return { status: "fail", reason: "runtime error in widget" };
    }
    if (r.bodyChars === 0) {
      return { status: "fail", reason: "empty body" };
    }
    return {
      status: "pass",
      info: { bodyChars: r.bodyChars, renderDurationMs: r.renderDurationMs },
    };
  },
  [KIND.WIDGET_DOM_CLICK]: (_a, outcome) => ackPass(outcome, true),
  [KIND.WIDGET_DOM_INPUT]: (_a, outcome) => ackPass(outcome, false),
  [KIND.WIDGET_DOM_CHANGE]: (_a, outcome) => ackPass(outcome, true),
  [KIND.WIDGET_DOM_SUBMIT]: (_a, outcome) => ackPass(outcome, false),
  [KIND.WIDGET_DOM_KEYDOWN]: (_a, outcome) => ackPass(outcome, false),
};

export function assertFor(action: Action): Asserter {
  return (ASSERTERS[action.kind] as Asserter | undefined) ?? passThrough;
}

export { ASSERTERS };
