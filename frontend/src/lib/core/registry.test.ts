import { describe, expect, it } from "vitest";
import {
  DRIVERS,
  allVolatilePaths,
  buildInitialState,
  driverFor,
} from "./registry";
import { studioAction, mcpAction, widgetAction } from "./__tests__/fixtures";

describe("registry", () => {
  it("buildInitialState__returns_all_four_slices_with_fresh_refs", () => {
    const a = buildInitialState();
    const b = buildInitialState();
    expect(a.studio).toBeDefined();
    expect(a.tools).toEqual({});
    expect(a.widgets).toEqual({ renderCount: 0, open: [] });
    expect(a.network).toEqual({
      requestCount: 0,
      responseCount: 0,
      errorCount: 0,
    });
    expect(a.widgets.open).not.toBe(b.widgets.open);
  });

  it("driverFor__resolves_each_driver_id", () => {
    expect(driverFor(studioAction("select", { selection: null })).id).toBe(
      "studio",
    );
    expect(
      driverFor(mcpAction("request", { id: 1, method: "x", params: {} })).id,
    ).toBe("mcp");
    expect(driverFor(widgetAction("opened", { uri: "x", data: null })).id).toBe(
      "widget",
    );
  });

  it("driverFor__throws_for_unknown_driver_id", () => {
    const bogus = {
      driver: "ghost",
      kind: "noop",
      source: "user",
      payload: {},
    };
    expect(() => driverFor(bogus as never)).toThrow(/no driver registered/);
  });

  it("allVolatilePaths__prefixes_paths_with_slice_key", () => {
    const paths = allVolatilePaths();
    expect(paths).toContain("tools.*.lastResult.id");
    expect(paths).toContain("widgets.open[*].data.id");
    expect(paths.some((p) => p.startsWith("studio."))).toBe(false);
  });

  it("DRIVERS__contains_three_drivers_in_declared_order", () => {
    expect(DRIVERS.map((d) => d.id)).toEqual(["studio", "mcp", "widget"]);
  });
});
