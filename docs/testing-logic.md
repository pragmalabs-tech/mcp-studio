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
3. Each disagreeing leaf becomes a `Drift`. Drifts at volatile paths
   are suppressed. Drifts already reported at an earlier step are
   skipped (carry-over).
4. `verdict.ok = true` iff no drift has `severity: "fail"`.

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

| Case                                | Action               | Slice path                |
| ----------------------------------- | -------------------- | ------------------------- |
| Selecting a tool from the sidebar   | `studio.select`      | `studio.selected`         |
| Selecting a resource                | `studio.select`      | `studio.selected`         |
| Clearing selection                  | `studio.select(null)`| `studio.selected`         |
| Editing tool args                   | `studio.set_args`    | `studio.editor.args`      |
| Updating theme / locale / display   | `studio.set_config`  | `studio.{theme,...}`      |
| Toggling strict CSP                 | `studio.set_config`  | `studio.strictMode`       |
| Switching viewport preset / custom  | `studio.set_config`  | `studio.viewport`         |
| Replacing the mock fixture          | `studio.set_mock`    | `studio.mock`             |

### MCP driver (`state.tools` + `state.network`)

| Case                                | Action             | Slice path(s)                       |
| ----------------------------------- | ------------------ | ----------------------------------- |
| Tool invocation count               | `mcp.request`      | `tools.<name>.callCount`            |
| Tool result attribution             | `mcp.response`     | `tools.<name>.lastResult`           |
| Tool error attribution              | `mcp.response`     | `tools.<name>.lastError`            |
| Request volume                      | `mcp.request`      | `network.requestCount`              |
| Response volume                     | `mcp.response`     | `network.responseCount`             |
| Error volume                        | `mcp.response`     | `network.errorCount`                |

Volatile (ignored by diff): server-generated ids, timestamps, the
`current_datetime` context block in tool results.

### Widget driver (`state.widgets`)

| Case                                | Action               | Slice path                        |
| ----------------------------------- | -------------------- | --------------------------------- |
| Widget open / render                | `widget.opened`      | `widgets.open[].{uri,data}`       |
| Render count                        | `widget.opened`      | `widgets.renderCount`             |
| Runtime error per open widget       | `widget.runtime_error`| `widgets.open[].hasErrors`       |
| DOM click intent                    | `widget.dom.click`   | (drives next Action via bridge)   |
| DOM input intent                    | `widget.dom.input`   | (drives next Action via bridge)   |
| DOM change intent                   | `widget.dom.change`  | (drives next Action via bridge)   |
| DOM submit intent                   | `widget.dom.submit`  | (drives next Action via bridge)   |
| DOM keydown intent                  | `widget.dom.keydown` | (drives next Action via bridge)   |

`dom.*` actions are **observations** at apply-time (same-state return).
They matter because they get replayed through the bridge into the
iframe; their downstream effects (state mutations from the widget's
own logic) are what gets asserted on the next step.

### CSP analysis (not in the verdict yet)

- Static scanner runs in the studio panel (live) and in the replay
  viewer's `WidgetPane` (post-mortem).
- Findings carry severity, directive, blocked URI, fix, source snippet.
- Surfaces: `<CspFindingsList>` in `ContentDialog` and `TraceModal`.
- **Not asserted.** A widget with new CSP errors still passes the diff
  as long as State matches. See `Future` below.

## What's deliberately NOT supported

| Excluded                              | Why                                                          |
| ------------------------------------- | ------------------------------------------------------------ |
| Visual / pixel diff                   | No screenshot infra. Widgets vary by viewport, font, theme.  |
| Wall-clock timing                     | Latency lives outside the State model.                       |
| Network payload bodies                | Only counts in State; full bodies would be noisy.            |
| Multi-iframe coordination             | One widget at a time today; stack present but unused.        |
| Mock fixture diff                     | `studio.mock` participates in State but isn't compared deep. |
| Cross-trace assertions                | Each Verdict is one trace vs one replay.                     |

## Future cases (priority-ordered)

### P0 - reuse existing data

| Case                                  | Where                                  |
| ------------------------------------- | -------------------------------------- |
| **CSP-in-diff**                       | Add `state.csp.findings` slice; differ |
|                                       | compares severity counts per step.     |
| **Tool result schema check**          | Optional JSON-schema attached to       |
|                                       | `mcp.response`; differ asserts shape.  |
| **Widget DOM error surfacing**        | Already in State; expose in TraceModal |
|                                       | with deep-link to failing step.        |

### P1 - new captures

| Case                                  | Needs                                  |
| ------------------------------------- | -------------------------------------- |
| **Tool arg assertions**               | Compare `mcp.request.payload.params`   |
|                                       | (currently volatile).                  |
| **Widget visual checkpoint**          | Capture `documentElement.outerHTML` at |
|                                       | end of render; differ compares hashes. |
| **Console / runtime error capture**   | Already partially via                  |
|                                       | `widget.runtime_error`; widen scope.   |
| **Network errors as first-class**     | `mcp.response.error` already stored;   |
|                                       | promote to slice field for diffing.    |

### P2 - workflow

| Case                                  | Notes                                  |
| ------------------------------------- | -------------------------------------- |
| **Step grouping / checkpoints**       | Mark "act 1 / act 2" in a Trace; let   |
|                                       | the diff scope to one act.             |
| **Auto-pause for human review**       | Engine flag: stop after step N so the  |
|                                       | reviewer can inspect before continuing.|
| **Run history persistence**           | In-memory today; promote to backend    |
|                                       | for CI / cross-session.                |
| **Test suites**                       | Run N traces, aggregate verdicts.      |

## How to add a new case

1. **Decide where it lives in State.** Pick the slice (or add a new
   one) and write the path you'll assert on.
2. **Add the Action kind.** Append to the appropriate union in
   `core/types.ts`. Source is one of `user / engine / widget / server`
   - this drives whether the engine `dispatch`es or `await`s it.
3. **Update the driver's `apply`.** Pure transition from old state to
   new state. Must be deterministic given the same inputs.
4. **Update `volatilePaths` if needed.** Add globs for any non-
   deterministic leaves the case introduces (timestamps, ids).
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
