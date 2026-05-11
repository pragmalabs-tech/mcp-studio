/**
 * Driver registry: composes slices into State, routes Actions to the
 * owning driver, aggregates volatile paths.
 *
 * Adding a driver: import it, add it to DRIVERS, extend SLICE_KEYS.
 */

import type { Action, Driver, DriverId, Matcher, State } from "./types";
import { studioDriver } from "./drivers/studio";
import { mcpDriver } from "./drivers/mcp";
import { widgetDriver } from "./drivers/widget";

/** Each driver's primary slice key on `State`. The differ uses this to
 *  prefix volatile paths to their full state-rooted form. */
export const SLICE_KEYS: Record<DriverId, keyof State> = {
  studio: "studio",
  mcp: "tools",
  widget: "widgets",
};

export const DRIVERS: readonly Driver[] = [
  studioDriver as Driver,
  mcpDriver as Driver,
  widgetDriver as Driver,
];

const BY_ID = new Map<DriverId, Driver>(DRIVERS.map((d) => [d.id, d]));

export function driverFor(action: Action): Driver {
  const d = BY_ID.get(action.driver);
  if (!d) {
    throw new Error(
      `no driver registered for action.driver="${action.driver}" (kind="${action.kind}")`,
    );
  }
  return d;
}

export function buildInitialState(): State {
  return {
    studio: studioDriver.initialSlice() as State["studio"],
    tools: mcpDriver.initialSlice() as State["tools"],
    widgets: widgetDriver.initialSlice() as State["widgets"],
    // network is shared (mcp + widget both write to it); registry owns init.
    network: { requestCount: 0, responseCount: 0, errorCount: 0 },
  };
}

export function allVolatilePaths(): string[] {
  const out: string[] = [];
  for (const d of DRIVERS) {
    const prefix = SLICE_KEYS[d.id];
    for (const p of d.volatilePaths()) out.push(`${prefix}.${p}`);
  }
  return out;
}

/** Aggregate driver-level shape matchers, slice-key-prefixed. Drivers
 *  that don't implement `matchPaths` contribute nothing. */
export function builtinMatch(): Record<string, Matcher> {
  const out: Record<string, Matcher> = {};
  for (const d of DRIVERS) {
    if (!d.matchPaths) continue;
    const prefix = SLICE_KEYS[d.id];
    for (const [pattern, matcher] of Object.entries(d.matchPaths())) {
      out[`${prefix}.${pattern}`] = matcher;
    }
  }
  return out;
}
