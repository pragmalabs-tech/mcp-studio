# State, StateChange, and Action.execute

> Status: shipped 2026-05-23. The synchronous shape described in §2 is in production. The async / implicit extensions sketched in §4 are designed but not built.

## 1. The invariant

**`StateChange` is the universal currency.** Anything that mutates the studio's State produces a `StateChange`. Today only Actions do; that doesn't have to stay true forever.

If we hold that invariant, nothing about the synchronous shape we ship today blocks the future async/implicit shape. New mutation sources (server push, timers, widget callbacks) plug into the same primitive without breaking existing code.

## 2. Today's shape

```
Action.execute(): Promise<StateChange>
       │
       └──► applyChange(state, change): State
```

That's the whole pipeline. Two stops, one async I/O method, one pure reducer.

### Action.execute

```ts
abstract class Action<T> {
  abstract execute(): Promise<StateChange>;
}
```

Each subclass is fully self-contained: it knows how to invoke its MCP operation **and** what slice of State that operation contributes. The result data the server returns lives *inside* the StateChange (`tools[name].lastResult`, `resources[uri].lastResult`) — there is no separate `action.result` field anywhere.

`ToolCallAction.execute()` calls `callTool(...)` (raw MCP wrapper) and feeds the response into `toolCallSuccess`/`toolCallFailure` builders. `ResourceReadAction.execute()` mirrors that with `readResource`. Both builders live in `lib/action/change-builders.ts`. Builders produce deterministic ids and timestamps (`requestId: 0`, `timestamp: 0`) so two runs of the same action+result yield equal StateChanges — no normalization pass needed.

### applyChange

```ts
function applyChange(state: State, change: StateChange): State;
```

Top-level structural merge: each `tools[name]` / `resources[uri]` slice replaces atomically; `network` replaces wholesale. Nobody calls this today (we compare StateChanges directly without maintaining a running State) — it's there as the canonical reducer for any future live state tracker.

### Recording and replay

- **Recording**: a caller constructs an Action, awaits `execute()`, and calls `recorder.record(action, { stateChange })`. The studio's `store.execute()` does this for the active tool/resource selection. The `mcp-interceptor` from earlier iterations is gone.
- **Replay**: the runner reconstructs each saved Action, awaits a fresh `execute()` to get a live StateChange, then compares with `verifyState(recordedChange, () => liveChange, { attempts, delayMs })`. One `AssertResult` per step.

The dialog renders Expected/Actual `StateChange`s side-by-side as JSON. The "action vs state" split the user wanted is preserved *visually* — the StateChange contains both a tool-or-resource slice (the "action" part: result/error/calls) and a network slice (the "state" part: counters) — but the *compare* is unified.

## 3. The retired Event layer

Three earlier iterations:

1. `Action.execute(): Event[]` + each Event has `apply(state) → State`. Events were intended for an event bus and audit log that never materialized.
2. `Action.execute(): Event[]` consumed by `changeOfAction(action, result)`. Still synthesizes events as scaffolding, plus a `Date.now()`-based requestId that has to be normalized away before comparing.
3. Current shape: events deleted, `execute` returns the StateChange directly.

Each iteration removed indirection without removing capability. The Event abstraction had one consumer; removing it deleted a whole `lib/event/` directory, the `applyEvent`/`applyEvents` reducers, the `changeOfAction` helper, the `completionEventFor` dispatch, and the `normalizeTimestamps` walk.

**Don't reintroduce Events.** If you need a new state-mutation source, see §4.

## 4. Forward-compatible extensions (designed, not built)

When async / implicit sources land — server push, setInterval, widget callbacks — the shape below extends today's primitives without touching `Action.execute` or `StateChange`.

### Tagged dispatch via a tracker

```ts
type ChangeSource =
  | { kind: "action"; actionId: string }     // bounded to an Action's execute
  | { kind: "subscription"; topic: string }  // MCP server push
  | { kind: "timer"; id: string }            // setInterval / setTimeout
  | { kind: "widget"; origin: string };      // postMessage from iframe

interface StateTracker {
  /** Apply a change to live state AND append it to the recorded timeline. */
  apply(change: StateChange, source: ChangeSource): void;
}
```

Any module can dispatch a StateChange with a tag describing where it came from. Action.execute still owns its own change; subscriptions and timers do the same independently.

### Timeline-shaped recording

Recording stops being a flat list of `RecordedAction`s and becomes a `(relMs, source, change)` timeline:

```ts
interface Session {
  actions: RecordedAction[];                  // user/MCP intents
  changes: Array<{                            // every mutation, regardless of source
    relMs: number;
    source: ChangeSource;
    change: StateChange;
  }>;
}
```

A test that records "click → tool call → server pushes update 200ms later" looks like:

```
action: click
change@0ms:    { source: action, ... }       — immediate
change@200ms:  { source: subscription, ... } — async tail
```

### Replay handles async by polling, not by re-firing

`verifyState`'s retry/sleep loop already covers brief async settling. For wider windows or implicit-source changes:

```ts
for (const recorded of session.changes) {
  if (recorded.source.kind === "action") {
    await runActionThatProducedIt(...);          // push
  }
  await waitForChange(recorded.change, { budgetMs: 1000 });   // pull
}
```

Action-sourced changes are pushed (re-execute the Action); implicit-sourced changes are pulled (wait for the trigger to fire on its own).

### Widget-internal state

Today `State.tools` / `State.resources` / `State.network` only cover MCP-side activity. Tracking widget state (whatever the iframe mutates) is one new slice:

```ts
interface State {
  tools: ...;
  resources: ...;
  network: ...;
  widget: Record<string, unknown>;   // new
}
```

The bridge layer turns iframe postMessages into `tracker.apply({ widget: {...} }, { kind: "widget", origin })`. `Action.execute()` doesn't change at all — widget state is a separate ChangeSource.

## 5. What we deliberately didn't build today

- **StateTracker / ChangeSource / timeline** — sync-only is enough until the first async source needs recording.
- **`state.widget` slice + iframe-bridge state pipe** — nothing in the studio currently asserts widget-internal behavior.
- **Multi-step Action settling** — actions are one-shot today. If a future tool returns a stream, `execute()` can return a Promise that resolves on stream completion *or* the Action emits multiple StateChanges via the tracker — both paths are open.

Pick these up when the use case lands, not before.
