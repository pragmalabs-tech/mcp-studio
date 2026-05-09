import { beforeEach, describe, expect, it } from "vitest";
import { recorder } from "./bus";
import { attachInstrumentation, type RecordableState } from "./instrumentation";
import type { Action } from "./schema";

function baseState(overrides: Partial<RecordableState> = {}): RecordableState {
  return {
    proxyUrl: "http://localhost:9000",
    authMethod: "bearer",
    token: "",
    oauth: { accessToken: null, selectedScopes: [], customHeaders: "" },
    platform: "claude",
    theme: "dark",
    displayMode: "inline",
    locale: "en-US",
    viewportPreset: "desktop",
    viewportCustom: { width: 0, height: 0 },
    strictMode: false,
    selected: null,
    editorValue: "{}",
    ...overrides,
  };
}

class FakeStore {
  state: RecordableState;
  private listeners = new Set<
    (state: RecordableState, prev: RecordableState) => void
  >();
  constructor(initial: RecordableState) {
    this.state = initial;
  }
  getState() {
    return this.state;
  }
  subscribe(listener: (state: RecordableState, prev: RecordableState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  setState(patch: Partial<RecordableState>) {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }
}

const captured: Action[] = [];
const collect = (a: Action) => {
  captured.push(a);
};

beforeEach(() => {
  if (recorder.mode === "recording") recorder.stop();
  captured.length = 0;
});

describe("attachInstrumentation", () => {
  it("emits nothing while recorder is idle", () => {
    const store = new FakeStore(baseState());
    const { detach } = attachInstrumentation(store, collect);
    store.setState({ platform: "openai" });
    expect(captured).toEqual([]);
    detach();
  });

  it("emits config.update with diff only", () => {
    const store = new FakeStore(baseState());
    const { detach } = attachInstrumentation(store, collect);
    recorder.start({
      connect: { url: "", auth: { method: "bearer", token: "" } },
      config: {
        platform: "claude",
        theme: "dark",
        displayMode: "inline",
        locale: "en-US",
        viewport: { preset: "desktop" },
        strictMode: false,
      },
    });
    store.setState({ platform: "openai", theme: "light" });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      kind: "config.update",
      patch: { platform: "openai", theme: "light" },
    });
    detach();
    recorder.stop();
  });

  it("emits sidebar.select on selection change", () => {
    const store = new FakeStore(baseState());
    const { detach } = attachInstrumentation(store, collect);
    recorder.start({
      connect: { url: "", auth: { method: "bearer", token: "" } },
      config: {
        platform: "claude",
        theme: "dark",
        displayMode: "inline",
        locale: "en-US",
        viewport: { preset: "desktop" },
        strictMode: false,
      },
    });
    store.setState({
      selected: { type: "tool", tool: { name: "search" } },
    });
    expect(captured).toEqual([
      {
        kind: "sidebar.select",
        selection: { type: "tool", name: "search" },
      },
    ]);
    detach();
    recorder.stop();
  });

  it("debounces editor changes and coalesces to final value", async () => {
    const store = new FakeStore(baseState());
    const { detach, flushEditor } = attachInstrumentation(store, collect);
    recorder.start({
      connect: { url: "", auth: { method: "bearer", token: "" } },
      config: {
        platform: "claude",
        theme: "dark",
        displayMode: "inline",
        locale: "en-US",
        viewport: { preset: "desktop" },
        strictMode: false,
      },
    });
    store.setState({ editorValue: '{"a":1}' });
    store.setState({ editorValue: '{"a":2}' });
    store.setState({ editorValue: '{"a":3}' });
    expect(captured).toEqual([]);
    flushEditor();
    expect(captured).toEqual([{ kind: "editor.set_args", value: { a: 3 } }]);
    detach();
    recorder.stop();
  });

  it("ignores non-whitelisted state changes", () => {
    const store = new FakeStore(baseState());
    const { detach } = attachInstrumentation(store, collect);
    recorder.start({
      connect: { url: "", auth: { method: "bearer", token: "" } },
      config: {
        platform: "claude",
        theme: "dark",
        displayMode: "inline",
        locale: "en-US",
        viewport: { preset: "desktop" },
        strictMode: false,
      },
    });
    // Mutate a field not in the whitelist (proxyConnected etc. aren't in
    // RecordableState, so we exercise via no-op identical updates).
    store.setState({ platform: "claude" });
    expect(captured).toEqual([]);
    detach();
    recorder.stop();
  });
});
