# Actions & Assertions

Reference for every recordable action in mcp-studio and how the differ
asserts against it on replay. Pairs with `CHANGELOG.md` (which lists
when each action / rule was added or changed).

Source of truth lives in `frontend/src/lib/core/types.ts` (Action
unions, Trace shape, Verdict) and `frontend/src/lib/core/drivers/*.ts`
(per-driver state transitions, volatile paths, built-in matchers).

## 1. The Action shape

Every recorded step wraps one `Action`. Actions have four fields
(`types.ts:14`):

| Field      | Values                                                   | Meaning                                               |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------- |
| `driver`   | `"studio"` \| `"mcp"` \| `"widget"`                      | Which driver owns the transition.                     |
| `kind`     | driver-specific string (e.g. `"set_args"`, `"request"`)  | What happened.                                        |
| `source`   | `"user"` \| `"engine"` \| `"widget"` \| `"server"`       | Decides drive-vs-await on replay (`types.ts:11`).     |
| `payload`  | kind-specific object                                     | Data needed for the transition + diff.                |

On replay, the engine **dispatches** `user` / `engine` actions and
**awaits** `widget` / `server` actions before moving on
(`engine.ts:71-104`).

A Step is `{relMs, action, stateAfter, compare?}` (`types.ts:211`):

- `relMs` is the step's timestamp in milliseconds, relative to the
  start of the trace (`performance.now() - t0`, see `engine.ts:76`).
  Step 0 is at or near `0`; later steps grow monotonically. It's
  informational only: the differ doesn't compare timing, only
  `stateAfter`.
- `stateAfter` is the diff target.
- `compare` is the per-step strategy (see §4).

## 2. State slices the differ asserts on

`State` is composed of four slices (`types.ts:140-145`). Each driver
owns one or two:

| Slice      | Owned by   | Fields                                                              |
| ---------- | ---------- | ------------------------------------------------------------------- |
| `studio`   | studio     | `selected`, `editor.args`, `mock`, plus `StudioConfig` (theme, viewport, displayMode, locale, strictMode). |
| `tools`    | mcp        | `{[toolName]: {callCount, lastResult?, lastError?}}`.               |
| `widgets`  | widget     | `renderCount`, `open[]`, `intents[]`, `activeRender`.               |
| `network`  | mcp + widget | `requestCount`, `responseCount`, `errorCount` (shared counters). |

The differ walks `stateAfter` pairs leaf by leaf; rule paths are
prefixed with the slice key when promoted to state-rooted form
(`registry.ts:49-69`).

## 3. Actions by driver

For each action: payload, source, state effect, and any per-driver
volatile / match paths that apply at diff time. Volatile paths are
silently ignored; match paths replace exact equality with a shape
check (see §4).

### 3.1 `studio` driver (`drivers/studio.ts`)

**Covers:** the studio shell itself. Every knob the user turns in the
UI is a studio action: sidebar selection (which tool / resource is
active), the args editor's JSON value, the active mock JSON, and the
viewport / theme / locale / displayMode / strictMode config. Things
that aren't recorded here: auth / profile (profile-scoped, lives in
`Trace.setup`), the MCP server URL.

Owns `state.studio`. No volatile paths, no match paths: every studio
field is deterministic on replay because they're user-driven shell
mutations.

| Kind          | Source | Payload                                                     | State effect                                   |
| ------------- | ------ | ----------------------------------------------------------- | ---------------------------------------------- |
| `select`      | user   | `{selection: {type, name} \| null}`                         | Sets `studio.selected`.                        |
| `set_args`    | user   | `{value: unknown}`                                          | Sets `studio.editor.args`.                     |
| `set_config`  | user   | `{patch: Partial<StudioConfig>}` (theme/viewport/displayMode/locale/strictMode) | Shallow-merges into `studio` (theme, viewport, ...). |
| `set_mock`    | user   | `{value: unknown}`                                          | Sets `studio.mock`.                            |

Definitions: `types.ts:17-43`.

### 3.2 `mcp` driver (`drivers/mcp.ts`)

**Covers:** JSON-RPC traffic between studio and the MCP server.
Outgoing requests (with the method name + params + originating
source) and incoming responses (with timing, result or error, and
the tool name when the request was a `tools/call`). The wire layer:
this is what would appear in a network panel for the MCP socket.

Owns `state.tools`; writes shared `state.network` counters.

| Kind       | Source                          | Payload                                                                                | State effect                                                                                              |
| ---------- | ------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `request`  | `user` \| `widget` \| `engine`  | `{id: number, method: string, params: unknown}`                                        | Bumps `network.requestCount`. If `method === "tools/call"`, bumps `tools[name].callCount`.                |
| `response` | `server`                        | `{requestId: number, tool?: string, durationMs: number, result?: unknown, error?: {message}}` | Bumps `network.responseCount` (and `errorCount` on `error`). If `tool` is set, writes `tools[tool].lastResult` or `.lastError`. |

`tool` is stamped at capture time from the matching `tools/call`
request so the transition doesn't need runtime heuristics
(`drivers/mcp.ts:1-7`).

Source rules: `user` requests fire from the tool panel, `widget` from
the iframe shim, `engine` are replay-injected. Responses are always
`server` and the engine awaits them rather than dispatching.

**Built-in volatile paths** (silently ignored, `drivers/mcp.ts:11-18`):

```
tools.*.lastResult.id
tools.*.lastResult.created_at
tools.*.lastResult.updated_at
tools.*.lastResult.data.id
tools.*.lastResult.data.created_at
tools.*.lastResult.data.updated_at
```

**Built-in match paths** (`drivers/mcp.ts:25-28`):

```
tools.*.lastResult.structuredContent.context.current_datetime → @iso8601
tools.*.lastResult.structuredContent.context.current_date_human → @any
```

These are spec'd MCP context fields that the server fills with
per-call values, so shape-asserting beats either dropping them or
red-flagging every replay.

### 3.3 `widget` driver (`drivers/widget.ts`)

**Covers:** everything happening inside the widget iframe. Renders
(which widget got mounted with which mock data), user-driven DOM
events against the widget (clicks, inputs, form submits, keydowns),
intents the widget posts back to the host (follow-up messages,
external links, widget-state updates), and runtime errors the iframe
throws. Tool calls the widget triggers don't live here: those are
`mcp.request` actions tagged with `source: "widget"`.

Owns `state.widgets`; writes shared `state.network.errorCount`.

| Kind             | Source   | Payload                                                                | State effect                                                                                |
| ---------------- | -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `render`         | user     | `{widgetName: string, mock: WidgetMock}`                               | Sets `widgets.activeRender`.                                                                |
| `opened`         | engine   | `{uri: string, data: unknown}`                                         | Appends to `widgets.open[]`; bumps `widgets.renderCount`.                                   |
| `intent`         | widget   | `{name: string, params: unknown}`                                      | Appends to `widgets.intents[]` (order-sensitive; differ asserts by array index).            |
| `runtime_error`  | widget   | `{message: string}`                                                    | Marks last `open[]` entry `hasErrors = true`; bumps `network.errorCount`.                   |
| `dom.click`      | user     | `{selectors: SelectorChain}`                                           | None (pure observation).                                                                    |
| `dom.input`      | user     | `{selectors, value: string, inputType: string}`                        | None.                                                                                       |
| `dom.change`     | user     | `{selectors, value: string}`                                           | None.                                                                                       |
| `dom.submit`     | user     | `{selectors}`                                                          | None.                                                                                       |
| `dom.keydown`    | user     | `{selectors, key: string, code: string, mods: number}`                 | None.                                                                                       |

Definitions: `types.ts:67-126`. `WidgetMock` shape: `types.ts:128-133`
(`{toolInput, toolOutput, meta, widgetState}`). `SelectorChain` shape:
`recorder/schema.ts:30-36` (testid / aria / text / css / xpath, in
that fallback order).

DOM events are pure observations: they don't move state. Their
*consequence* (a tools/call, a re-render, a posted intent) appears as
the next Action in the trace, and *that* transition is what the
differ asserts on (`drivers/widget.ts:1-8`).

**Built-in volatile paths** (`drivers/widget.ts:12-22`):

```
widgets.open[*].data.id
widgets.open[*].data.created_at
widgets.open[*].data.updated_at
widgets.open[*].data.data.id
widgets.open[*].data.data.created_at
widgets.open[*].data.data.updated_at
widgets.intents[*].params.callId
```

`callId` is from the legacy openai shim (random per outgoing
request); without ignoring it every intent would drift on every
replay.

**Built-in match paths**: none.

## 4. Assertion model

The differ produces a `Verdict` (`types.ts:277`): `{ok, drifts[]}`.
`ok` is true iff every `fail` drift carries `suppressedBy` (i.e. a
rule let it through). `warn` drifts pass the verdict regardless.

### 4.1 Per-step compare mode

Set on `Step.compare` (`types.ts:215-219`). Defaults to `exact`.

| Mode      | Behavior                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `exact`   | Leaf values must match; array lengths must match; extra keys are drifts (`differ.ts:106, 144, 176`).               |
| `shape`   | Same JSON type at each leaf is the contract. Leaf value mismatches don't drift (`differ.ts:109`); arrays walk only the common prefix (`differ.ts:142`); extra keys are forward-compatible (`differ.ts:175`). |

Use `shape` on steps whose `stateAfter` includes content that
legitimately varies across envs (search results, generated text,
counters). The UI sets it via the Compare control on each result-row.

### 4.2 Drift reasons

Emitted by `differ.ts` (`types.ts:325-331`):

| Reason          | When                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `missing`       | Key/index present in recorded, absent in replayed (`differ.ts:151, 170`).                              |
| `extra`         | Key/index present in replayed, absent in recorded (`differ.ts:148, 176`). Suppressed in shape mode for object keys. |
| `value_differs` | Same JSON type, different leaf value (`differ.ts:106, 129`).                                           |
| `type_differs`  | JSON types disagree at a leaf (`differ.ts:101`). Match rules don't apply.                              |
| `step_missing`  | Recorded has a step at index `i`, replayed doesn't (`differ.ts:47`).                                   |
| `step_extra`    | Replayed has a step at index `i`, recorded doesn't (`differ.ts:43`).                                   |

Severity is `fail` by default. A `match` rule that passes downgrades
to `warn` (`differ.ts:118-124`); a `match` rule that fails stays
`fail` (`differ.ts:125`).

### 4.3 Rules: ignore and match

Rules suppress or reshape what would otherwise be a drift
(`differ.ts:1-19`, `rules.ts`):

| Rule       | Effect                                                                                                  | Resulting drift                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ignore`   | Silently drop the disagreement.                                                                          | `severity: "fail"` (unchanged) with `suppressedBy: {layer: "*.ignore", pattern}`. Doesn't count toward verdict. |
| `match`    | Replace exact equality with a shape/format check on both recorded and replayed leaves.                   | Both pass → `severity: "warn"` with `suppressedBy: {layer: "*.match", pattern}`. Either fails → `severity: "fail"`, no suppression. |

#### Rule layers

Rules accumulate from two sources (`rules.ts:22-42`):

1. **Built-in** (registry.ts:49-69): driver-declared volatile paths
   and match paths, slice-prefixed. Always active.
2. **Per-trace** (`Trace.rules`, `types.ts:252`): editable from the
   View Rules dialog on each test row.

Layer attribution on suppressed drifts is one of
`builtin.ignore | builtin.match | trace.ignore | trace.match` so the
UI can explain *why* a drift was let through.

For overlapping `match` patterns on the same path, the **last
matching pattern wins** (`rules.ts:53-62`). Built-in matches come
first in the array; per-trace matches override them.

#### Matchers

Match rules use one of these matchers (`types.ts:245-250`,
`rules.ts:80-101`):

| Matcher              | Passes when                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `"@any"`             | Value is defined.                                                                        |
| `"@iso8601"`         | String matches ISO-8601 datetime (`YYYY-MM-DDTHH:MM:SS[.fff][Z\|±HH:MM]`).                |
| `"@uuid"`            | String matches UUID v1-v5.                                                                |
| `"@epoch"`           | Integer number, `>= 1e9` (works for both seconds and ms).                                 |
| `{regex: "..."}`     | String value matches the given regex (non-string values fail).                            |

### 4.4 Path syntax

Rule paths use glob-style segments (`rules.ts`):

- `*` matches one path segment (`tools.*.lastResult` covers any tool).
- `[*]` matches any array index (`open[*].data.id`).
- Literal segments are dot-separated; array indices are bracketed.

Paths are state-rooted: `tools.create_course.lastResult.id`,
`widgets.open[0].data.created_at`, `studio.editor.args`, etc.

### 4.5 Auto-classifier

On unsuppressed `value_differs` drifts where both sides share a
known shape (datetime, UUID, epoch, JWT, AWS/Stripe keys,
high-entropy strings), the differ attaches a `classification` hint
(`types.ts:303-322`). The UI surfaces a one-click "Apply" affordance
to add the corresponding `match` or `ignore` rule. Classification
never changes verdict; it only suggests.

Sensitive shapes (JWT, AWS key, Stripe key, high entropy) always
suggest `ignore` (never `match`), and the UI masks the value in the
drift card so shape-asserting doesn't leak the secret.

## 5. Worked examples

Each example below shows a recorded action sequence, the relevant
slice of `stateAfter` that the differ asserts on, and the kinds of
drift the test would catch (or deliberately let through).

### 5.1 Calling a tool from the panel

Scenario: the user picks `get_course` in the sidebar, types args,
clicks Execute. The MCP server returns the course payload.

Recorded steps (abbreviated):

```
0  studio.select       payload: { selection: { type: "tool", name: "get_course" } }
1  studio.set_args     payload: { value: { course_id: "abc-123" } }
2  mcp.request   (user)   payload: { id: 1, method: "tools/call",
                                     params: { name: "get_course",
                                               arguments: { course_id: "abc-123" } } }
3  mcp.response  (server) payload: { requestId: 1, tool: "get_course", durationMs: 143,
                                     result: { structuredContent: { course: {...} } } }
```

`stateAfter` at step 3 (relevant parts):

```
studio.selected = { type: "tool", name: "get_course" }
studio.editor.args = { course_id: "abc-123" }
tools.get_course = {
  callCount: 1,
  lastResult: { structuredContent: { course: { id: "abc-123", title: "Intro to MCP" } } }
}
network = { requestCount: 1, responseCount: 1, errorCount: 0 }
```

What replay asserts (per step):

- **Step 0:** `studio.selected.name === "get_course"`.
- **Step 1:** `studio.editor.args` deep-equals recorded.
- **Step 2:** dispatched by the engine (source: `user`). `tools.get_course.callCount` ticks to 1; `network.requestCount` ticks to 1.
- **Step 3:** awaited by the engine (source: `server`). `tools.get_course.lastResult` deep-equals recorded under exact compare; built-in volatile paths drop drift on `lastResult.id` / `created_at` / `updated_at`. If the response carries `structuredContent.context.current_datetime`, the built-in match rule shape-checks it as ISO-8601 (warn-level drift if it differs but parses, fail if it doesn't parse).

If the server starts returning a different shape (e.g. `course` renamed to `courses`), step 3 emits `type_differs` or `missing` drifts under `tools.get_course.lastResult.…`.

### 5.2 Widget render, DOM interaction, intent

Scenario: a tool call returns a widget. The user clicks a button
inside it; the widget posts an intent back to the host (e.g.
`sendFollowUpMessage`).

```
0  mcp.request   (user)   tools/call create_question
1  mcp.response  (server) { tool: "create_question", result: {…widget mock…} }
2  widget.render (user)   { widgetName: "create_question_widget",
                            mock: { toolInput, toolOutput, meta, widgetState } }
3  widget.dom.click (user) { selectors: [{ testid: "submit-btn" }] }
4  widget.intent (widget)  { name: "sendFollowUpMessage",
                             params: { prompt: "Next question" } }
```

`stateAfter` at step 4 (widgets slice):

```
widgets.activeRender = { widgetName: "create_question_widget", mock: {…} }
widgets.intents = [ { name: "sendFollowUpMessage", params: { prompt: "Next question" } } ]
widgets.open = []          // no widget.opened was recorded
widgets.renderCount = 0    // bumped by widget.opened, not widget.render
```

What replay asserts:

- **Step 2:** `widgets.activeRender.widgetName` matches; `widgets.activeRender.mock` is deep-compared. If the mock's `toolOutput` includes env-varying data, flip this step to `compare: "shape"` or add a `Trace.rules.match` entry.
- **Step 3:** `dom.click` is a **pure observation** (no state change). The engine dispatches the synthetic click sequence via the bridge so React/Radix handlers wired to `mousedown`/`pointerdown` fire; the test passes as long as the *next* expected action arrives. If the click doesn't trigger step 4 within `awaitMs` (default 2000ms), the differ surfaces `step_missing` at index 4.
- **Step 4:** `widgets.intents[0].name === "sendFollowUpMessage"`, `widgets.intents[0].params.prompt === "Next question"`. **Order is positional.** A second intent emitted in a different order would drift at `widgets.intents[0].name`.

### 5.3 Widget triggers a tool call (cross-driver flow)

Scenario: the widget's button calls `openai.callTool()`. The engine
sees an `mcp.request` with `source: "widget"`, not from the tool
panel.

```
0  widget.render
1  widget.dom.click (user)    { selectors: [{ testid: "refresh-btn" }] }
2  mcp.request  (widget)      { id: 2, method: "tools/call",
                                params: { name: "refresh_state", arguments: {} } }
3  mcp.response (server)      { requestId: 2, tool: "refresh_state", result: {…} }
4  widget.intent (widget)     { name: "setWidgetState", params: { state: {…} } }
```

What replay asserts:

- **Step 1** dispatches the click on the iframe. No state change directly.
- **Step 2** is `source: "widget"`, so the engine **awaits** it (matching on `driver: "mcp"`, `kind: "request"`). The expectation is "the click I just dispatched causes the iframe to fire this request". If it doesn't arrive within `awaitMs`, step_missing fires here, not at step 1.
- **Step 3** asserts `tools.refresh_state.lastResult` (with the usual volatile paths applied).
- **Step 4** asserts the intent the widget posts after receiving the response.

This is the canonical "the widget actually does work" test: user input → widget logic → tool call → state update → intent emission, all in order.

### 5.4 Env-varying response: use shape mode

Scenario: a search tool returns a variable number of results
depending on the env's data. You want to assert the response shape
but not the count or per-result content.

Set `compare: "shape"` on the response step (Compare control on the
result row, or edit the trace directly):

```
3  mcp.response  (server)  compare: "shape"
   payload: { requestId: 1, tool: "search_courses",
              result: { structuredContent: { results: [
                { id: "…", title: "…", score: 0.91 },
                …
              ] } } }
```

Under `shape` at step 3 (`differ.ts:84-180`):

- `results[*]` walks only the common prefix. Replay returning fewer items doesn't emit `missing`.
- Per-item leaves (`id`, `title`, `score`) are compared by JSON **type** only, not value. So `id: "abc"` recorded vs `id: "xyz"` replayed passes.
- Extra keys the server later adds (e.g. `relevance_score`) don't drift.

You would still fail on:

- The tool attribution changing (`mcp.response.tool` is exact-compared on the action; `compare` only affects `stateAfter`).
- The response shape itself changing (`results: [...]` → `results: { items: [...] }` is a `type_differs` regardless of mode).
- The server returning `error` instead of `result` (the differ sees `lastError` set instead of `lastResult`).

### 5.5 Asserting an error response

Scenario: the test deliberately calls a tool with bad input and
expects an error.

```
2  mcp.request  (user)   payload: { id: 1, method: "tools/call",
                                    params: { name: "get_course",
                                              arguments: { course_id: "" } } }
3  mcp.response (server) payload: { requestId: 1, tool: "get_course",
                                    durationMs: 12,
                                    error: { message: "course_id required" } }
```

`stateAfter` at step 3:

```
tools.get_course = { callCount: 1, lastError: { message: "course_id required" } }
network = { requestCount: 1, responseCount: 1, errorCount: 1 }
```

What replay asserts:

- `tools.get_course.lastResult` is **absent**; if a replay starts returning a result, the differ emits `extra` at `tools.get_course.lastResult` and `missing` at `tools.get_course.lastError`.
- `network.errorCount === 1`.
- Error message is exact-compared. If the server tweaks wording, use `Trace.rules.match` with a `{regex}` matcher or set `compare: "shape"` on the step.

## 6. Quick recipes

| Symptom on replay                                                                              | Fix                                                                                |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Tool response has a generated `id`/`created_at` that drifts.                                   | Already covered by built-in `mcp` volatile paths; if your field name differs, add it under `Trace.rules.ignore`. |
| Tool response includes a non-deterministic ISO datetime not in `structuredContent.context`.    | Add `Trace.rules.match = {"tools.*.lastResult.…": "@iso8601"}`.                  |
| A list of activities or search results varies in length across envs.                           | Set `Step.compare = "shape"` on the asserting step.                                |
| Widget intent order matters and the recorded test asserts on it.                               | No action needed: `intents[]` is positional; the differ already asserts by index.  |
| Widget posts an extra forward-compatible field in `params`.                                    | Set `Step.compare = "shape"` so extra keys don't drift, OR add a `trace.ignore` for that exact path. |
| Replayed run took a different code path and one step is missing.                               | The differ emits `step_missing`. Investigate (usually a missing await on a `widget` / `server` action) or re-record. |

## 7. Adding a new action kind

1. Extend the relevant action union in `types.ts` with `{driver, kind, source, payload}`.
2. Handle the kind in the owning driver's `apply()` (`drivers/<id>.ts`); update its slice immutably.
3. If the action originates outside `user` (i.e. `widget` / `server` / `engine`), wire `attach()` to emit it onto the bus and `dispatch()` if the engine needs to drive it on replay.
4. If the transition writes paths that vary across envs, declare them in `volatilePaths()` or `matchPaths()` on the driver.
5. Add a row to the table in §3 of this doc.
