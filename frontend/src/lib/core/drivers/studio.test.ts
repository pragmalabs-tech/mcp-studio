import { describe, expect, it } from "vitest";
import { studioDriver } from "./studio";
import { studioAction, emptyState, makeState } from "../__tests__/fixtures";

describe("studio driver", () => {
  it("initialSlice__returns_studio_defaults", () => {
    expect(studioDriver.initialSlice()).toEqual({
      selected: null,
      editor: { args: {} },
      theme: "dark",
      viewport: { preset: "mobile" },
      displayMode: "inline",
      locale: "en-US",
      strictMode: false,
      mock: null,
    });
  });

  it("initialSlice__returns_fresh_value_each_call", () => {
    const a = studioDriver.initialSlice() as { selected: unknown };
    const b = studioDriver.initialSlice() as { selected: unknown };
    expect(a).not.toBe(b);
    a.selected = "tampered";
    expect(b.selected).toBeNull();
  });

  it("apply_select__sets_selected", () => {
    const after = studioDriver.apply(
      emptyState(),
      studioAction("select", { selection: { type: "tool", name: "weather" } }),
    );
    expect(after.studio.selected).toEqual({ type: "tool", name: "weather" });
  });

  it("apply_select__clears_when_payload_is_null", () => {
    const before = makeState({
      studio: { ...emptyState().studio, selected: { type: "tool", name: "x" } },
    });
    expect(
      studioDriver.apply(before, studioAction("select", { selection: null }))
        .studio.selected,
    ).toBeNull();
  });

  it("apply_set_args__replaces_editor_args_wholesale", () => {
    const after = studioDriver.apply(
      emptyState(),
      studioAction("set_args", { value: { city: "Tokyo" } }),
    );
    expect(after.studio.editor.args).toEqual({ city: "Tokyo" });
  });

  it("apply_set_config__merges_only_patch_keys", () => {
    const before = emptyState();
    const after = studioDriver.apply(
      before,
      studioAction("set_config", {
        patch: { theme: "light", strictMode: true },
      }),
    );
    expect(after.studio.theme).toBe("light");
    expect(after.studio.strictMode).toBe(true);
    expect(after.studio.viewport).toBe(before.studio.viewport);
  });

  it("apply_set_config__returns_same_state_on_noop", () => {
    const before = emptyState();
    const after = studioDriver.apply(
      before,
      studioAction("set_config", { patch: { theme: before.studio.theme } }),
    );
    expect(after).toBe(before);
  });

  it("apply_set_mock__sets_and_clears", () => {
    const set = studioDriver.apply(
      emptyState(),
      studioAction("set_mock", { value: { x: 1 } }),
    );
    expect(set.studio.mock).toEqual({ x: 1 });
    const cleared = studioDriver.apply(
      set,
      studioAction("set_mock", { value: null }),
    );
    expect(cleared.studio.mock).toBeNull();
  });

  it("volatilePaths__returns_empty", () => {
    expect(studioDriver.volatilePaths()).toEqual([]);
  });
});
