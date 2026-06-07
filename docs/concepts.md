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
- Result fields: WidgetClickAction's shape plus `applied` (`boolean | null`) — whether the widget actually took the input (see §5)
- StateChange: increments `widgets[widgetId].inputCount`; same event aggregation as WidgetClickAction
- Open-window: auto-closes after 800ms of input silence; snapshot is captured before `close()` to freeze pre-reaction DOM
- On replay, accepts an optional `ExecuteContext` (`{ previous }`) so it can recover an ephemeral editor (see §5)

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
| WidgetTextInputAction | `success`, `matched`, `applied`, `errorMessage` |

Widget actions do not verify `snapshot` or `matchedSelector` — those are informational. The primary signal is whether the click/input matched at all (`matched`) and whether events fired (via state delta counters).

### Failure Propagation

- Per-point failures accumulate in `AssertResult.data.failures[]`
- Any point failure → step status `"failed"`
- Any state mismatch → step status `"failed"`
- Any failed step → replay status `"failed"`

---

## 5. Widget Text Input — How Text Is Entered

Replay runs inside the user's own browser (the app is an Axum server serving the
frontend), so it can only produce **synthetic** events. The browser treats those
as `isTrusted: false` and **skips the default text-insertion action** — a fake
`keydown` fires listeners but never changes a field's value. So
`WidgetTextInputAction` enters text by two paths, not by replaying keystrokes:

**1. Matched field (real `<input>`/`<textarea>`/contenteditable)**
Set the value, then dispatch `input`/`change` so the widget's framework reacts:
- The native value setter and the events are taken from the **iframe's own realm**
  (`doc.defaultView.HTMLTextAreaElement.prototype`, `doc.defaultView.InputEvent`),
  **not** the host page's. A host-realm setter writes the raw DOM value but leaves
  the iframe framework's value-tracker stale, so a controlled editor (e.g. React)
  reads the old value on commit and nothing renders.
- `applied` = the value read back equal to what we set (real proof it stuck).

**2. Fallback (no field matched)**
Dispatch realm-correct `keydown`/`keypress`/`keyup` at the document root. This only
works for apps that **read `e.key` themselves** (canvas games, custom editors).
- `applied = true` if the app produced `input`/`beforeinput` events from our keys;
  `null` if a handler only called `preventDefault()` (consumed, unverifiable —
  could be a shortcut); `false` if nothing reacted.

### Ephemeral editors (e.g. Excalidraw)

Some canvas apps mount a transient editor (`textarea.excalidraw-wysiwyg`) on a
click and **destroy it on blur** — including the blur caused by the gap between
the open-click step and the type step. The text field is simply gone by the time
the type step runs.

Recovery, all within the one type step (no gap for the editor to die in):
- The runner threads the **previous** action into `execute({ previous })`.
- Click/canvas actions report `endFocus` (what held focus at step end) and expose
  `reopen(doc)` (replay their click without touching their result/window).
- If no candidate matches **and** `previous.endFocus.editable` is true, the type
  step calls `previous.reopen(doc)` to recreate the editor, re-finds the field,
  types via path 1, and commits (Escape / Cmd+Enter).

### Limitation

Anything that requires a **genuinely trusted** event cannot be reproduced from
page JS: IME composition, native file pickers, real drag-drop, or canvas apps that
ignore untrusted `keydown`. Producing trusted input needs an external driver
(Playwright / CDP `chromiumoxide` / WebDriver `thirtyfour`) running a real
Chromium below the page — a future automated-runner concern, not the in-browser
replay. (Tauri is not a shortcut: its macOS WKWebView has no CDP.)

---

## 6. Widget Snapshots

After each action settles, the studio captures the widget iframe's HTML and stores it as a **snapshot** on the action result. Snapshots are review artifacts — they are shown in the result dialog side-by-side (Recorded vs Replay) so you can visually compare what happened in the original recording against what happened during replay. They are never asserted.

### The canvas problem

The browser's `document.documentElement.outerHTML` serializes the DOM tree but **not** `<canvas>` pixel content. A canvas element's drawing lives in a GPU/memory buffer that is invisible to the DOM. When the snapshot HTML is rendered in the `SnapshotPane` preview (a sandboxed iframe with scripts blocked), every canvas appears blank — even if the original widget was showing a fully drawn diagram.

For canvas-heavy widgets like Excalidraw this made the snapshot useless: you'd see an empty white box where the diagram should be.

### The fix — `serializeDoc`

Before serializing, `serializeDoc(doc)` (`lib/action/utils/serialize-doc.ts`):

1. Finds every `<canvas>` in the live document.
2. Calls `canvas.toDataURL()` on each to capture the current pixels as a base64 PNG.
3. Clones the document tree and swaps each `<canvas>` for an `<img src="data:...">` carrying that PNG.
4. Returns `outerHTML` of the modified clone.

The result is a self-contained HTML string where canvas drawings are frozen as images. When rendered in the snapshot pane (no scripts needed), the diagram appears correctly.

Two edge cases are handled silently:
- **Tainted canvas** — `toDataURL()` throws a `SecurityError` if the canvas has drawn cross-origin content. The canvas element is left as-is (appears blank).
- **Empty canvas** — `toDataURL()` returns the stub `"data:,"` for a canvas that was never drawn on. Left as-is too.

`serializeDoc` is a no-op for documents with no canvas elements (returns `outerHTML` directly), so non-canvas widgets pay no cost.
