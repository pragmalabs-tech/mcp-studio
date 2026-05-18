// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "./store";

// The store has 7 deferred auto-side-effects (setTimeout(loadWidget|
// applyMock, 50)) that fire on user-facing setters during recording for
// UX. During REPLAY (studioMode === "test") they must be skipped — the
// engine drives renders explicitly via widget.render Actions; an extra
// loadWidget would fire a duplicate resources/read and pollute the
// replay timeline. These tests pin down that gating.

describe("studio store replay-mode gating", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useStudioStore.setState({ studioMode: "normal" });
  });

  function stubAutoReloaders() {
    const loadWidget = vi.fn();
    const applyMock = vi.fn();
    useStudioStore.setState({ loadWidget, applyMock });
    return { loadWidget, applyMock };
  }

  it("setPlatform schedules loadWidget in normal mode", () => {
    const { loadWidget } = stubAutoReloaders();
    useStudioStore.setState({ studioMode: "normal" });
    useStudioStore.getState().setPlatform("claude");
    vi.advanceTimersByTime(100);
    expect(loadWidget).toHaveBeenCalled();
  });

  it("setPlatform skips loadWidget in test mode", () => {
    const { loadWidget } = stubAutoReloaders();
    useStudioStore.setState({ studioMode: "test" });
    useStudioStore.getState().setPlatform("claude");
    vi.advanceTimersByTime(100);
    expect(loadWidget).not.toHaveBeenCalled();
  });

  it("setTheme schedules applyMock in normal mode", () => {
    const { applyMock } = stubAutoReloaders();
    useStudioStore.setState({ studioMode: "normal" });
    useStudioStore.getState().setTheme("dark");
    vi.advanceTimersByTime(100);
    expect(applyMock).toHaveBeenCalled();
  });

  it("setTheme skips applyMock in test mode", () => {
    const { applyMock } = stubAutoReloaders();
    useStudioStore.setState({ studioMode: "test" });
    useStudioStore.getState().setTheme("dark");
    vi.advanceTimersByTime(100);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("setLocale, setDisplayMode, setStrictMode also skip in test mode", () => {
    const { loadWidget, applyMock } = stubAutoReloaders();
    useStudioStore.setState({ studioMode: "test" });
    useStudioStore.getState().setLocale("ja-JP");
    useStudioStore.getState().setDisplayMode("fullscreen");
    useStudioStore.getState().setStrictMode(true);
    vi.advanceTimersByTime(100);
    expect(loadWidget).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });
});
