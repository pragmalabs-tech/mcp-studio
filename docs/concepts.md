# MCP Studio — Core Concepts

## 1. Actions

An **Action** is the atomic unit of recorded work. It represents one user interaction or MCP operation and can be recorded, replayed, and verified.

### Lifecycle

```
execute() → populates action.result (async I/O)
change()  → derives StateChange from result (pure, no I/O)
```

`execute()` and `change()` are always separate. Result data lives on the Action; counter deltas live in the StateChange.

### Action Types

**ToolCallAction**
Calls an MCP tool by name with params.
- Result fields: `success`, `isError`, `content`, `structuredContent`, `errorMessage`, `widget` (resolved `ui://` URI), `snapshot` (iframe HTML after render)
- StateChange: increments `tools[tool].callCount`, network counters, optionally `widgets[uri].renderCount`

**ResourceReadAction**
Reads an MCP resource by URI.
- Result fields: `success`, `contents`, `errorMessage`
- StateChange: increments `resources[uri].readCount`, network counters

**WidgetClickAction**
Clicks an element inside a rendered widget iframe. Uses a CSS selector candidate list; first match wins.
- Result fields: `success`, `matched` (bool), `matchedSelector`, `matchedIndex`, `errorMessage`, `snapshot`
- StateChange: increments `widgets[widgetId].clickCount`; aggregates any tool calls / widget renders that fired during the click settle window
- Open-window: `execute()` returns immediately; replay waits for expected events, then calls `close()`

**WidgetTextInputAction**
Types a value into an input inside a widget iframe.
- Same result shape as WidgetClickAction
- StateChange: increments `widgets[widgetId].inputCount`; same event aggregation as WidgetClickAction
- Open-window: auto-closes after 800ms of input silence; snapshot is captured before `close()` to freeze pre-reaction DOM

### Events

An **Event** is an MCP-level side effect that fires during an action's execute window (e.g. a tool call triggered by a widget click). Events are routed to the currently active Action via the EventBus and accumulate in `action.events`. They are not independently verified — their effect surfaces only through StateChange counters.

Event types: `ToolsCallEvent`, `ResourcesReadEvent`, `WidgetRenderEvent`.

---

## 2. State

**State** is a counter-based snapshot of "what happened how many times" against the MCP surface. It holds no payloads — only counts.

```typescript
interface State {
  tools:     Record<string, { callCount: number }>;
  resources: Record<string, { readCount: number }>;
  widgets:   Record<string, { renderCount: number; clickCount: number; inputCount?: number }>;
  network:   { requestCount: number; responseCount: number; errorCount: number };
}
```

### StateChange

A `StateChange` is a sparse partial of `State` — the counter delta one action contributes. Applied via `applyChange(state, change)`.

State and result are kept separate intentionally:
- **Result** (on Action) = what the MCP returned
- **StateChange** = how many times things were called

This lets replay compare them independently.

---

## 3. Assertion Logic

### Modes

A **mode** is a comparison strategy applied to a single field when verifying a live result against a recorded baseline.

| Mode | Behavior |
|------|----------|
| `exact` | Deep structural equality. Default for most fields. |
| `shape` | Infers JSON Schema from recorded value; validates live value against it. Enforces types and structure, tolerates value changes. |
| `flaky` | Tree-walks both values; skips leaves that are the same "flaky kind" (UUID, ISO date, JWT, epoch-ms, epoch-s). |
| `ignore` | Always passes. Use for non-deterministic or irrelevant fields. |

### Assertable Points

Each action type declares a static list of **AssertablePoints** — named, labeled pointers into `ActionResult` with a default mode and the set of modes that make sense for that field.

Example points for ToolCallAction: `success` (exact/ignore), `content` (exact/shape/flaky/ignore), `widget` (exact/ignore).

### Config

```typescript
interface TestAssertionConfig {
  defaults?: { state?: Mode };
  perAction?: Record<string, {
    result?: Record<string, Mode>;  // key = AssertablePoint.key
    state?: Mode;
  }>;
}
```

Mode resolution order:
- **Per-field**: `perAction[actionId].result[key]` → `point.defaultMode`
- **State**: `perAction[actionId].state` → `defaults.state` → `"exact"`

---

## 4. Replay & Assertions per Action Type

### Replay Loop

For each recorded action:

1. Reconstruct live Action instance from JSON (`reconstructAction`)
2. Activate action on EventBus (routes incoming events to it)
3. Execute (see per-type below)
4. Verify action result against recorded baseline
5. Verify state delta against recorded StateChange
6. Store results; advance to next action

### Execution Strategy

**Direct actions** (ToolCallAction, ResourceReadAction):
```
execute() → awaits MCP response → result populated
```

**Open-window actions** (WidgetClickAction, WidgetTextInputAction):
```
execute() → returns immediately (window is open)
waitUntil(action.events.length >= expectedEventCount, 5000ms)
wait 150ms (DOM rerender grace)
close()   → settles the window
await execute promise
```
Expected event count comes from the recorded action's event list.

### Assertion Per Action Type

All action types run two verifications per step:

**1. Action result verify** — walks each AssertablePoint, extracts value by path from `action.result`, compares via resolved mode.

**2. State delta verify** — compares `action.change()` against recorded `stateChange` using a single resolved mode. Retries up to 3× with 50ms backoff for async state settlement.

Per-type assertable points:

| Action | Points verified |
|--------|----------------|
| ToolCallAction | `success`, `isError`, `content`, `structuredContent`, `errorMessage`, `widget` |
| ResourceReadAction | `success`, `contents`, `errorMessage` |
| WidgetClickAction | `success`, `matched`, `errorMessage` |
| WidgetTextInputAction | `success`, `matched`, `errorMessage` |

Widget actions do not verify `snapshot` or `matchedSelector` — those are informational. The primary signal is whether the click/input matched at all (`matched`) and whether events fired (via state delta counters).

### Failure Propagation

- Per-point failures accumulate in `AssertResult.data.failures[]`
- Any point failure → step status `"failed"`
- Any state mismatch → step status `"failed"`
- Any failed step → replay status `"failed"`
