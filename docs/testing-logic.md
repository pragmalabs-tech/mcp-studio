# Supported testing logic

Source of truth for what mcp-studio asserts in a replay, what it
deliberately ignores, and what's worth adding next. Every new test
case should fit one of the categories below or extend one explicitly.

## The verdict model

Verdict comes from a **pairwise State diff**:

1. Replay folds each Action through `apply()` to produce
   `stateAfter` per step (just like recording did).
2. `differ.diff` walks the recorded vs replayed `stateAfter` leaves
   for every step pair.
3. Each disagreeing leaf becomes a `Drift`. Rules can suppress a drift
   (mark with `suppressedBy`) or replace exact-equality with a shape
   check; see [Per-test rules](#per-test-rules). Drifts already
   reported at an earlier step are skipped (carry-over).
4. `verdict.ok = true` iff every `severity: "fail"` drift has
   `suppressedBy` set.

What this implies:

- **Asserted = anything that lands in State.** If a behavior doesn't
  mutate a slice, it isn't checked.
- **Action stream alone isn't enough.** Two traces with identical
  Actions but different state outcomes both fail. Two traces with
  different Actions but identical end-state succeed.
- **Order matters.** Steps are paired by index. A length mismatch
  produces `step_missing` / `step_extra`.

## What's supported today

### Studio driver (`state.studio`)

| Case                               | Action                | Slice path           |
| ---------------------------------- | --------------------- | -------------------- |
| Selecting a tool from the sidebar  | `studio.select`       | `studio.selected`    |
| Selecting a resource               | `studio.select`       | `studio.selected`    |
| Clearing selection                 | `studio.select(null)` | `studio.selected`    |
| Editing tool args                  | `studio.set_args`     | `studio.editor.args` |
| Updating theme / locale / display  | `studio.set_config`   | `studio.{theme,...}` |
| Toggling strict CSP                | `studio.set_config`   | `studio.strictMode`  |
| Switching viewport preset / custom | `studio.set_config`   | `studio.viewport`    |
| Replacing the mock fixture         | `studio.set_mock`     | `studio.mock`        |

### MCP driver (`state.tools` + `state.network`)

| Case                    | Action         | Slice path(s)             |
| ----------------------- | -------------- | ------------------------- |
| Tool invocation count   | `mcp.request`  | `tools.<name>.callCount`  |
| Tool result attribution | `mcp.response` | `tools.<name>.lastResult` |
| Tool error attribution  | `mcp.response` | `tools.<name>.lastError`  |
| Request volume          | `mcp.request`  | `network.requestCount`    |
| Response volume         | `mcp.response` | `network.responseCount`   |
| Error volume            | `mcp.response` | `network.errorCount`      |

Volatile (ignored by diff): server-generated ids and timestamps
(`*.lastResult.id`, `created_at`, `updated_at`, plus the same under
`*.lastResult.data`).

Built-in matchers (shape-asserted instead of dropped):
`context.current_datetime` must be `@iso8601`,
`context.current_date_human` must be `@any` (present, any value).

### Widget driver (`state.widgets`)

| Case                                        | Action                 | Slice path                                                 |
| ------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| Widget open / render                        | `widget.opened`        | `widgets.open[].{uri,data}`                                |
| Render count                                | `widget.opened`        | `widgets.renderCount`                                      |
| Runtime error per open widget               | `widget.runtime_error` | `widgets.open[].hasErrors`                                 |
| Mock applied to widget (which widget + data) | `widget.render`        | `widgets.activeRender.{widgetName,mock}`                   |
| Widget→host intent (sendFollowUpMessage, …) | `widget.intent`        | `widgets.intents[]` (append-only `{name, params}`)         |
| DOM click intent                            | `widget.dom.click`     | (drives next Action via bridge)                            |
| DOM input intent                            | `widget.dom.input`     | (drives next Action via bridge)                            |
| DOM change intent                           | `widget.dom.change`    | (drives next Action via bridge)                            |
| DOM submit intent                           | `widget.dom.submit`    | (drives next Action via bridge)                            |
| DOM keydown intent                          | `widget.dom.keydown`   | (drives next Action via bridge)                            |

`dom.*` actions are **observations** at apply-time (same-state return).
They matter because they get replayed through the bridge into the
iframe; their downstream effects (state mutations from the widget's
own logic) are what gets asserted on the next step.

`widget.render` records what data the widget was rendered against
(`activeRender.widgetName`, `activeRender.mock.{toolInput, toolOutput,
meta, widgetState}`). The differ asserts on this cell, so the test
fails if replay loads the wrong widget or feeds it different data.
Flaky payloads (UUIDs, timestamps inside `mock.toolOutput`) are
managed with per-step shape mode or path-level rules; the widget name
itself is always exact-compared so a regression that loads the wrong
widget can't silently pass.

`widget.intent` is the higher-level surface above DOM events: things
the widget posts back to the host (sendFollowUpMessage, setWidgetState,
openExternal, ui/message, ui/open-link, etc.). Tool calls
(`callTool` / `ui/call-server-tool`) are NOT here — those are already
captured as `mcp.request` with `source: "widget"`. Intents append to
`widgets.intents[]` in order, so a test fails if an expected prompt
isn't sent or a different prompt fires.

#### Widget render lifecycle (record + replay symmetry)

1. **HTML fetch** is captured as a normal `mcp.request resources/read`
   action. A store subscriber on the recorder bus derives
   `widgetSourceHtml` from `mcp.response` events for `ui://*` URIs —
   pure deterministic derivation, runs identically in record and
   replay.
2. **`widget.render` action** carries `{widgetName, mock}`. The driver
   updates `state.widgets.activeRender`. The runtime dispatch handler
   calls `store.applyWidgetMock` which writes `currentMock`.
3. **Iframe mounts once per widget URL.** `WidgetFrame` keeps `srcdoc`
   stable across mock-only updates; new mocks flow into the live
   iframe via `postMessage({type: "studio_set_mock", mock})`. The injected
   `mock-openai` shim mutates `window.openai.toolInput / toolOutput /
   widgetState` in place and dispatches a `openai:set_globals`
   CustomEvent so the React widget can re-render without an iframe
   reload.
4. **Engine awaits the bridge** (`awaitRenderComplete`) only on the
   first mount of a new widget. Same-widget mock updates wait two
   animation frames (~32ms) for React to commit, then continue. The
   bridge's selector retry covers any remaining timing slack (up to
   2s per dispatch).

Everything that mutates state goes through actions on the bus, so
record and replay use the SAME code paths. There are no
`recorder.suspend()` workarounds.

### Per-test rules

A Trace can carry its own `rules: TraceRules` (optional), additive on top
of the built-in driver defaults. Rules let you keep an assertion meaningful
across runs when one field is expected to vary.

Two kinds:

| Kind     | Effect                                                                  |
| -------- | ----------------------------------------------------------------------- |
| `ignore` | Drift at this path is suppressed entirely. Use when the value is noise. |
| `match`  | Replaces exact-equality with a shape check. Use when the value should   |
|          | still be _present_ and _well-formed_, just not byte-identical.          |

Both keys take path globs with the same `*` / `[*]` semantics as the
driver-level volatile patterns:

```json
"rules": {
  "ignore": ["widgets.open[*].data.session_id"],
  "match":  { "tools.*.lastResult.context.request_id": "@uuid" }
}
```

Built-in matchers: `@any` (defined value), `@iso8601` (string in
ISO-8601 datetime format), `@uuid`, `@epoch` (integer >= 1e9), or
`{ "regex": "<pattern>" }` for a user-supplied regex on string values.

Resolution order: built-in → trace. Within `match`, the last matching
pattern wins, so trace rules override built-in defaults for the same
path. `ignore` is additive (presence is enough).

#### Per-step compare mode (shape vs exact)

A `Step` can carry `compare: "exact" | "shape"`. Default `exact`.
`shape` mode asserts JSON structure but allows leaf values to differ
at that step's `stateAfter` walk:

- Skips `value_differs` at leaves (same type = no drift).
- Skips array length differences (walks common prefix only).
- Keeps `type_differs` (string vs number is a real contract break).
- Keeps `missing` object keys (response dropped a documented field).
- Suppresses `extra` object keys (forward-compatible: server may add
  fields; not a regression).

UX: open the result modal, select the noisy step, flip the **Compare**
dropdown to **Shape only**. Persists onto the recorded trace as
`steps[i].compare = "shape"` and the differ re-runs in place. Shape
mode is the right tool when a tool response has structurally stable
shape but volatile content (UUIDs, timestamps, paginated lists,
LLM-generated text). For surgical control, use `match` rules instead.

Suppressed drifts are **kept** in the verdict but carry `suppressedBy:
{ layer, pattern }` so the UI can show what was let through. `verdict.ok`
ignores anything with `suppressedBy` or with `severity: "warn"`.

#### Severity tiers

Drifts render in one of three tiers in the result modal:

| Tier   | When                                                                                                                     | Visible by default  | Verdict                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------ |
| red    | `severity: "fail"`, no `suppressedBy` — a real disagreement with no rule cover                                           | yes                 | counts as fail                             |
| yellow | `severity: "warn"` (a `match` rule passed but values differed) **or** classifier hit on a fail drift (suggestion banner) | yes (always)        | passes if `warn`, fails if classifier-only |
| gray   | `suppressedBy: *.ignore` — explicit `ignore` rule covered the path                                                       | no (toggle to show) | passes                                     |

The yellow tier is the important new affordance. With it, a passing
`match` no longer hides itself: you see the values differed, the
matcher held, and the test stayed green. That's both a confirmation
and a flag in case the matcher was too permissive.

#### Auto-classifier (suggestions)

Each surfaced fail drift is run through a heuristic classifier that
spots common volatile shapes:

| Kind           | Detects                                  | Suggests             |
| -------------- | ---------------------------------------- | -------------------- | -------------------- |
| `iso8601`      | both sides are ISO-8601 datetime strings | `match @iso8601`     |
| `uuid`         | both sides are UUIDs                     | `match @uuid`        |
| `epoch`        | both ints ≥ 1e9 within ±90 days          | `match @epoch`       |
| `jwt`          | both `eyJ…` three-segment tokens         | `ignore` (sensitive) |
| `aws_key`      | both `AKIA…` 20-char keys                | `ignore` (sensitive) |
| `stripe_key`   | both `sk*/pk*(test                       | live)\_…`            | `ignore` (sensitive) |
| `high_entropy` | both ≥ 32 chars in token alphabet        | `ignore` (sensitive) |

The classifier never auto-applies; it surfaces a yellow banner next to
the drift with an **Apply** button. Sensitive-shape values render
masked (`AKIA••••••••AB4F`) until the user explicitly reveals them,
and the suggested action is `ignore` rather than `match` — secrets
shouldn't land in the trace's rule set.

#### The review loop

The intended workflow when a real test failure includes noise:

1. Run the replay; the modal lands on the first failing step.
2. The right pane shows full-width drift cards: expected/got, the
   classifier's suggestion (if any), and inline rule actions.
3. Click **Apply** on a suggestion, or **ignore exact / ignore
   `tools.*.…`** / **match as…** for a manual rule.
4. The trace is persisted (rules ride along with the saved test) and
   the verdict re-computes against the existing replayed steps — no
   re-run needed.

Use the **Rules** button in the modal header to review every rule
applied (built-in read-only + trace-level editable) and to test a path
against the resolved rule set before committing.

### CSP analysis (not in the verdict yet)

- Static scanner runs in the studio panel (live) and in the replay
  viewer's `WidgetPane` (post-mortem).
- Findings carry severity, directive, blocked URI, fix, source snippet.
- Surfaces: `<CspFindingsList>` in `ContentDialog` and `TraceModal`.
- **Not asserted.** A widget with new CSP errors still passes the diff
  as long as State matches. See `Future` below.

## What's deliberately NOT supported

| Excluded                  | Why                                                          |
| ------------------------- | ------------------------------------------------------------ |
| Visual / pixel diff       | No screenshot infra. Widgets vary by viewport, font, theme.  |
| Wall-clock timing         | Latency lives outside the State model. `relMs` is recorded   |
|                           | but not asserted.                                            |
| Network payload bodies    | `mcp.request.params` are not asserted by default (volatile). |
|                           | Tool result IS asserted via `tools.<name>.lastResult`.       |
| Multi-iframe coordination | One widget active at a time. `widgets.open[]` is a stack but |
|                           | only the top entry is interactively driven.                  |
| Cross-trace assertions    | Each Verdict is one trace vs one replay.                     |
| Server-side regressions   | Replay calls the live MCP — content differences across envs |
|                           | are handled with shape mode / rules, not by switching to a  |
|                           | recorded-response fixture.                                   |

## Future cases (priority-ordered)

### P0 - reuse existing data

| Case                           | Where                                  |
| ------------------------------ | -------------------------------------- |
| **CSP-in-diff**                | Add `state.csp.findings` slice; differ |
|                                | compares severity counts per step.     |
| **Tool result schema check**   | Optional JSON-schema attached to       |
|                                | `mcp.response`; differ asserts shape.  |
| **Widget DOM error surfacing** | Already in State; expose in TraceModal |
|                                | with deep-link to failing step.        |

### P1 - new captures

| Case                                | Needs                                  |
| ----------------------------------- | -------------------------------------- |
| **Tool arg assertions**             | Compare `mcp.request.payload.params`   |
|                                     | (currently volatile).                  |
| **Widget visual checkpoint**        | Capture `documentElement.outerHTML` at |
|                                     | end of render; differ compares hashes. |
| **Console / runtime error capture** | Already partially via                  |
|                                     | `widget.runtime_error`; widen scope.   |
| **Network errors as first-class**   | `mcp.response.error` already stored;   |
|                                     | promote to slice field for diffing.    |

### P2 - workflow

| Case                            | Notes                                   |
| ------------------------------- | --------------------------------------- |
| **Step grouping / checkpoints** | Mark "act 1 / act 2" in a Trace; let    |
|                                 | the diff scope to one act.              |
| **Auto-pause for human review** | Engine flag: stop after step N so the   |
|                                 | reviewer can inspect before continuing. |
| **Run history persistence**     | In-memory today; promote to backend     |
|                                 | for CI / cross-session.                 |
| **Test suites**                 | Run N traces, aggregate verdicts.       |

## How to add a new case

1. **Decide where it lives in State.** Pick the slice (or add a new
   one) and write the path you'll assert on.
2. **Add the Action kind.** Append to the appropriate union in
   `core/types.ts`. Source is one of `user / engine / widget / server`
   - this drives whether the engine `dispatch`es or `await`s it.
3. **Update the driver's `apply`.** Pure transition from old state to
   new state. Must be deterministic given the same inputs.
4. **Update `volatilePaths` / `matchPaths` if needed.** Drivers declare
   coarse, protocol-level defaults that apply to every test
   (`volatilePaths` for "drop", `matchPaths` for "assert shape"). For
   per-test customization, use the Trace's `rules` field instead —
   driver defaults stay narrow.
5. **Wire capture.** Either through `recorder.emit(...)` from the
   live code path, or through a driver's `attach()` if the data is
   already on the bus.
6. **Wire replay.** If the Action is user/engine-sourced, implement
   `driver.dispatch` in `runtime.ts`. If widget/server-sourced, the
   engine awaits it automatically once `attach` emits.
7. **Test.** Add a `xxx.test.ts` next to the module - one test per
   contract (apply, volatile, capture).

## Anti-cases

Things that look like test cases but shouldn't be:

- **"Test that the widget renders without errors."** Already covered:
  `widgets.open[].hasErrors` + `network.errorCount`.
- **"Test the tool was called with the right args."** Reframe as:
  promote tool args from volatile to State, then assert on State.
  Don't add a side-channel.
- **"Test that strict mode produces fewer CSP findings."** Reframe as
  CSP-in-diff with severity counts; the live panel already shows it.
- **"Compare two recordings for regression."** That's already the
  model - record once, replay later, diff. Don't build a parallel
  comparator.

## Operational notes

- A trace's `setup` is environment config (URL, profileId). State is
  the scoreboard. Don't move setup fields into State - they'd be
  flagged on every replay against a different env.
- `findActiveWidget` in `TraceModal` resolves HTML directly from
  `mcp.response.result.contents[]` rather than pairing
  request-id <-> response-id. Pairing fails on traces recorded across
  sessions where the recorder counter has reset.
- Run history (`TestsPage`) is in-memory only; refresh clears it.
