// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWidgetStore } from "./stores/widget-store";
import { useTestStore } from "./stores/test-store";

describe("studio store replay-mode gating", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useTestStore.setState({ studioMode: "normal" });
  });

  function stubAutoReloaders() {
    const loadWidget = vi.fn();
    const applyMock = vi.fn();
    useWidgetStore.setState({ loadWidget, applyMock });
    return { loadWidget, applyMock };
  }

  it("setPlatform updates platform and does not call loadWidget", () => {
    const { loadWidget } = stubAutoReloaders();
    useTestStore.setState({ studioMode: "normal" });
    useWidgetStore.getState().setPlatform("claude");
    vi.advanceTimersByTime(100);
    expect(useWidgetStore.getState().platform).toBe("claude");
    expect(loadWidget).not.toHaveBeenCalled();
  });

  it("setPlatform skips reInjectAll in test mode", () => {
    const { loadWidget } = stubAutoReloaders();
    useTestStore.setState({ studioMode: "test" });
    useWidgetStore.getState().setPlatform("claude");
    vi.advanceTimersByTime(100);
    expect(loadWidget).not.toHaveBeenCalled();
  });

  it("setTheme schedules applyMock in normal mode", () => {
    const { applyMock } = stubAutoReloaders();
    useTestStore.setState({ studioMode: "normal" });
    useWidgetStore.getState().setTheme("dark");
    vi.advanceTimersByTime(100);
    expect(applyMock).toHaveBeenCalled();
  });

  it("setTheme skips applyMock in test mode", () => {
    const { applyMock } = stubAutoReloaders();
    useTestStore.setState({ studioMode: "test" });
    useWidgetStore.getState().setTheme("dark");
    vi.advanceTimersByTime(100);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("setLocale, setDisplayMode, setStrictMode also skip in test mode", () => {
    const { loadWidget, applyMock } = stubAutoReloaders();
    useTestStore.setState({ studioMode: "test" });
    useWidgetStore.getState().setLocale("ja-JP");
    useWidgetStore.getState().setDisplayMode("fullscreen");
    useWidgetStore.getState().setStrictMode(true);
    vi.advanceTimersByTime(100);
    expect(loadWidget).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });
});
