# Cue: MCP Studio Test Specification

> A **Cue** is a declarative test for an MCP server. The name borrows from
> theatre: a cue tells the actors when to enter, what to do, and what to
> say. A Cue file tells mcp-studio what to do against a server and what
> should be true at each step.
>
> **Status:** Source of truth for v1 of the Cue format. Hand-authored Cues,
> agent-authored Cues (Claude Code, Cursor, etc.), and recorder exports all
> conform to this spec.
>
> When the spec and the implementation disagree, this document is right and
> the implementation is a bug.

---

## 1. Architecture frame

```
        Cue (JSON, hand-authored or recorder-exported)
                          │
                          ▼
              Translator (mcp-studio internal)
                          │
                          ▼
        Engine IR (low-level Action stream)
                          │
                          ▼
       Drivers (chrome / mcp / widget) → Asserters → Report
```

A Cue is the **user-facing test format**. It is declarative: a Cue is a
sequence of named steps where each step is either an action ("do something")
or an assertion ("claim something is true").

The mcp-studio engine translates a Cue into its internal Action IR at
execution time. Cues written by humans, by AI agents, or exported from the
recorder all go through the same translator and run on the same engine.

**Two consumers, one format:**

- **Humans / agents** write Cues by hand to express intent: "this tool
  should return a number", "this widget should show the city name".
- **Studio recorder** exports Cues by transforming captured low-level events
  into the same primitives a human would have written.

---

## 2. Cue envelope

A Cue file is a single JSON object:

```jsonc
{
  "schema_version": 2,
  "id": "uuid-v4",
  "name": "Search flow renders results",
  "description": "Optional human description of what this Cue proves.",
  "setup": {
    "profile": "prod-admin",
    "requires": {
      "tools": ["search", "details"],
      "resources": ["ui://search/results"]
    }
  },
  "fixtures": {
    "query": "weather Tokyo"
  },
  "steps": [
    /* Step objects, see §4 */
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema_version` | yes | Always `2` for this spec. Engines reject other versions with a clear error. |
| `id` | yes | UUID v4. Stable across renames so reports can correlate. |
| `name` | yes | Short human-readable label. Shown in the catalog. |
| `description` | no | Free-form prose. Agents should populate this with the Cue's intent. |
| `setup.profile` | no | Profile name to activate before running. Omit = run against active profile. |
| `setup.requires.tools` | no | Tool names that must exist on the server. The Cue fails at precondition if missing. |
| `setup.requires.resources` | no | Resource URIs that must exist on the server. Same precondition behavior. |
| `fixtures` | no | Constants the Cue interpolates via `{{ name }}`. Strings, numbers, booleans, or nested objects. |
| `steps` | yes | Ordered list of Step objects. Empty array is invalid. |

Unknown top-level keys are a hard error (catches typos like `step` vs `steps`).

---

## 3. Path syntax (used by `expect`, `bind`, `match`)

Wherever a path appears, it uses this small dot-syntax:

| Syntax | Means |
|---|---|
| `a.b.c` | nested object property |
| `a[0]`, `a[3]` | array index (zero-based) |
| `a[*]` | every element in an array (gather) |
| `a[*].b` | gather `b` from every element |
| `a["weird key"]` | bracket form for keys that don't fit identifier rules |
| `$` | the root of the value being matched |

There is no recursive descent (`..`) and no predicate filters (`?(...)`) in v1.
Keep paths boring; they show up in error messages.

When a path uses `[*]`, the matcher applies to **each gathered element** for
shape-style matchers (`type`, `equals`, etc.) and to **the whole array** for
size-style matchers (`length`, `contains`).

---

## 4. Step object

Every step is an object with a discriminator field `kind`:

```jsonc
{ "kind": "<namespace>.<verb>", /* fields per verb */ }
```

Four namespaces, no others:

- `mcp.*` — JSON-RPC interactions with the MCP server
- `widget.*` — interactions with a rendered widget (HTML surface)
- `assert.*` — standalone assertions not attached to a single action
- `flow.*` — flow control

Unknown `kind` values are a hard error at translation time. New action kinds
require a spec update.

---

## 5. The `mcp.*` namespace

Three primitives cover the entire MCP JSON-RPC spec. New methods on either
side automatically work without schema changes.

### 5.1 `mcp.call` — client-to-server request

Sends a JSON-RPC request, awaits the response, runs assertions against it.

```jsonc
{
  "kind": "mcp.call",
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "city": "{{ city }}" }
  },
  "expect": { /* matcher, see §8 */ },
  "bind": { "first_temp": "result.structuredContent.temperature_c" },
  "timeout_ms": 5000
}
```

| Field | Required | Notes |
|---|---|---|
| `method` | yes | Any MCP method string (`tools/list`, `tools/call`, `resources/read`, `prompts/get`, `completion/complete`, `ping`, ...). |
| `params` | no | JSON-RPC params object. Strings interpolate `{{ vars }}`. |
| `expect` | no | Matcher applied to the **result** envelope (see §8). Implicit defaults still apply (no error, response received). |
| `bind` | no | `{ var_name: "path" }` map. Engine evaluates each path against the result and stores. |
| `timeout_ms` | no | Per-call timeout. Defaults to the engine's per-method timeout. |

**Implicit assertions (always on):**

- A response is received before timeout.
- `result.isError` is not `true` (when present).

If a response carries `result._meta.openai/outputTemplate` (or the equivalent
widget reference), the engine waits for the next `widget.render.complete`
before the next step. No widget call required for the wait.

### 5.2 `mcp.notify` — client-to-server notification

Sends a JSON-RPC notification. No response. No assertion possible against the
notification itself; subsequent steps observe its effects.

```jsonc
{
  "kind": "mcp.notify",
  "method": "notifications/initialized",
  "params": { /* optional */ }
}
```

### 5.3 `mcp.expect` — wait for an inbound message

Used for server-initiated requests (`sampling/createMessage`, `roots/list`)
and notifications (`notifications/progress`, `notifications/resources/updated`,
`notifications/message`).

```jsonc
{
  "kind": "mcp.expect",
  "type": "notification",
  "method": "notifications/progress",
  "match": { "params.progressToken": "{{ token }}", "params.progress": { "gte": 100 } },
  "timeout_ms": 5000,
  "bind": { "final_progress": "params.progress" }
}
```

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `"request"` or `"notification"`. |
| `method` | yes | Method name to wait for. |
| `match` | no | Matcher applied to the inbound message (`params` for notifications, full envelope for requests). |
| `respond` | no | Only valid when `type: "request"`. Object the client should send back. |
| `timeout_ms` | no | How long to wait. Defaults to engine setting. |
| `bind` | no | Capture values from the matched message. |

If `type: "request"` and `respond` is omitted, the engine sends an empty result
`{}`.

---

## 6. The `widget.*` namespace

Widgets are HTML rendered inside an iframe. The widget namespace covers
loading, interacting, waiting, and asserting against rendered widgets.

### 6.1 `widget.open`

Common macro: pick a tool, execute it with args, await the widget render.
Equivalent to a `mcp.call` for `tools/call` plus an implicit wait for
`widget.render.complete`. Use this instead of raw `mcp.call` when the Cue's
intent is "render this widget".

```jsonc
{
  "kind": "widget.open",
  "tool": "get_weather",
  "args": { "city": "{{ city }}" },
  "expect": { /* matcher applied to the tool response, see §8 */ },
  "bind": { "first_temp": "structuredContent.temperature_c" }
}
```

**Implicit assertions:**

- Tool response declares a widget (`_meta.openai/outputTemplate` or
  equivalent).
- Widget renders within timeout.
- `bodyChars > 0` after render.
- No runtime errors during render.

### 6.2 `widget.click`

Click an element matching a locator.

```jsonc
{
  "kind": "widget.click",
  "target": { "role": "button", "name": "Refresh" },
  "expect": { /* WidgetExpect, see §6.6 */ }
}
```

**Implicit assertion:** the target was found (selector did not miss).

### 6.3 `widget.fill`

Fill a text input or textarea. Replaces a `keydown + change` sequence.

```jsonc
{
  "kind": "widget.fill",
  "target": { "label": "City" },
  "value": "Tokyo"
}
```

**Implicit assertions:** target found, input's `.value` equals the supplied
value after dispatch.

### 6.4 `widget.wait_for`

Wait until a condition holds. Use sparingly; prefer implicit waits inside the
preceding action.

```jsonc
{
  "kind": "widget.wait_for",
  "target": { "text": "Loaded" },
  "condition": { "type": "visible" },
  "timeout_ms": 2000
}
```

**Conditions:**

| `condition.type` | Means |
|---|---|
| `"visible"` | Target exists and is visually rendered (not `display: none`, in viewport bounds). |
| `"hidden"` | Target does not exist or is not rendered. |
| `"text"` | Target's text content matches `condition.value` (string for equals, `{ matches: "regex" }` for regex). |
| `"count"` | Number of elements matching `target` equals `condition.value` (number or matcher). |

### 6.5 Locator vocabulary

A locator identifies one element in the rendered widget. Tagged union:

```ts
type Locator =
  | { text: string; exact?: boolean }
  | { role: string; name?: string | { matches: string } }
  | { label: string }
  | { placeholder: string }
  | { testid: string }
  | { alt: string }
  | { title: string }
  | { css: string }
  | { chain: Locator[] };
```

| Locator | Resolves via | Use when |
|---|---|---|
| `text` | Visible text content (trimmed, normalized whitespace). `exact: true` for full equality. | Most-stable choice for buttons, links, headings. |
| `role` + optional `name` | ARIA role with optional accessible name match. | Form controls, semantic UI, Playwright parity. |
| `label` | Form field associated with a `<label>` element. | Form inputs. |
| `placeholder` | `placeholder` attribute on an input/textarea. | Inputs without labels. |
| `testid` | `data-testid` attribute. | Icon-only buttons or anything without natural semantics. |
| `alt` | `alt` attribute on an image. | Images. |
| `title` | `title` attribute. | Tooltipped elements. |
| `css` | Raw CSS selector. | Escape hatch. Avoid when a semantic locator works. |
| `chain` | List of locators tried in order; first match wins. | Resilience ladders, recorder exports. |

**Authoring guidance for agents:** prefer `text`, `role+name`, `label`,
`testid` in that order. Use `css` only when nothing else fits. Use `chain`
when you want a fallback ladder.

**Recorder behavior:** the recorder's IR-to-Cue transform always emits
`chain` with the full ladder it captured. Authors don't need to.

### 6.6 `widget.expect` — assertions about the widget

Assertions that don't ride on a single action.

```jsonc
{
  "kind": "widget.expect",
  "expect": [
    { "kind": "no_runtime_errors" },
    { "kind": "no_csp_violations" },
    { "kind": "text", "contains": "Tokyo" },
    { "kind": "text", "matches": "\\d+°C" },
    { "kind": "visible", "target": { "role": "button", "name": "Refresh" } },
    { "kind": "triggers_mcp_call", "method": "tools/call",
      "match": { "params.name": "get_weather" }, "within_ms": 1000 }
  ]
}
```

**Available `WidgetExpect` kinds in v1:**

| Kind | Fields | Means |
|---|---|---|
| `text` | `target?: Locator`, `equals?`, `contains?`, `matches?` | Text inside `target` (or whole body) matches. |
| `visible` | `target: Locator` | Element exists and is visually rendered. |
| `no_runtime_errors` | — | No JS errors thrown in the iframe since this Cue started. |
| `no_csp_violations` | `since?: "cue_start" \| "last_action"` | No new CSP violations in the window. Defaults to `"last_action"`. |
| `triggers_mcp_call` | `method`, `match?`, `within_ms?` | A matching MCP call fired within the window. Used after `widget.click` to assert behavior. |

`expect` can be a single `WidgetExpect` object or an array. All entries must
pass for the step to pass.

---

## 7. The `assert.*` namespace

Standalone assertions about state that doesn't tie to one action.

### 7.1 `assert.tool_response`

Assert against the most recent `mcp.call` (optionally filtered by method).

```jsonc
{
  "kind": "assert.tool_response",
  "method": "tools/call",
  "match_params": { "name": "get_weather" },
  "expect": {
    "structuredContent.temperature_c": { "type": "number" },
    "structuredContent.condition": { "type": "string" }
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `method` | no | Filter by method name. Omit = most recent call of any kind. |
| `match_params` | no | Filter by params subset (deep partial match). |
| `expect` | yes | Matcher applied to the response result (see §8). |

If no matching call has occurred, the step fails with a clear message.

---

## 8. The expect / matcher language

One vocabulary, used everywhere a value is checked: `mcp.call.expect`,
`mcp.expect.match`, `widget.open.expect`, `assert.tool_response.expect`,
`widget.wait_for` predicates.

### 8.1 Shape

`expect` is an object whose **keys are paths** (§3) and **values are
matchers**:

```jsonc
"expect": {
  "result.isError": false,
  "result.content[0].type": "text",
  "result.content[0].text": { "matches": "Tokyo.*°C" },
  "result.structuredContent.humidity": { "type": "number", "between": [0, 100] },
  "result._meta.openai/outputTemplate": { "exists": true }
}
```

All keys must pass for `expect` to pass. The order of keys does not matter.

### 8.2 Matcher vocabulary

| Matcher | Matches when |
|---|---|
| literal value (`42`, `"text"`, `true`, `null`) | strict deep equality |
| `{ "type": <jsontype> }` | value's JSON type matches (`"string"`, `"number"`, `"boolean"`, `"array"`, `"object"`, `"null"`) |
| `{ "exists": true }` | path resolves to anything (including `null`, `false`) |
| `{ "exists": false }` | path does not resolve |
| `{ "equals": <any> }` | strict deep equality (explicit form) |
| `{ "matches": "regex" }` | string matches regex (anchored with explicit anchors only) |
| `{ "contains": <string \| value> }` | string substring or array includes (matcher applies to elements) |
| `{ "shape": { ... } }` | recursive subset deep match (specified keys present and match; extra keys ignored) |
| `{ "between": [min, max] }` | number in inclusive range |
| `{ "gte": N }` / `{ "lte": N }` / `{ "gt": N }` / `{ "lt": N }` | numeric comparison |
| `{ "length": N \| <matcher> }` | array or string length check |
| `{ "all_of": [matchers] }` | every matcher passes |
| `{ "any_of": [matchers] }` | at least one matcher passes |
| `{ "not": <matcher> }` | matcher does not pass |

Matchers compose: `{ "all_of": [{ "type": "number" }, { "between": [0, 100] }] }`.

### 8.3 Wildcards in paths

When a path contains `[*]`:

- For shape-style matchers (`type`, `equals`, `matches`, `shape`, numeric
  comparisons): the matcher applies to **each gathered element**. All must
  pass.
- For collection-style matchers (`length`, `contains`, `includes`): the
  matcher applies to **the gathered array**.

Disambiguate explicitly with `all_of` if the inferred behavior is wrong.

---

## 9. Variables and interpolation

### 9.1 Capture (`bind`)

Any action can carry a `bind` map: variable name → path evaluated against the
action's result.

```jsonc
{
  "kind": "mcp.call",
  "method": "tools/call",
  "params": { "name": "create_session", "arguments": {} },
  "bind": { "session_id": "result.structuredContent.id" }
}
```

After this step, `{{ session_id }}` is interpolatable in subsequent steps.

### 9.2 Interpolate

Anywhere a string field appears in a Cue, `{{ name }}` is replaced with the
captured value. Interpolation is evaluated at the moment the step runs.

```jsonc
{
  "kind": "mcp.call",
  "method": "tools/call",
  "params": {
    "name": "use_session",
    "arguments": { "id": "{{ session_id }}" }
  }
}
```

Type coercion: if the surrounding string is exactly `{{ name }}` (no other
content), the value is substituted with its native type (number, boolean,
object). Otherwise the value is stringified.

### 9.3 Built-in scopes

| Scope | Source | Example |
|---|---|---|
| `fixtures.X` | The Cue's `fixtures` object | `{{ fixtures.city }}` |
| (bare name) | Most recent `bind` for that name (Cue-scoped) | `{{ session_id }}` |
| `env.X` | Process environment variable (CI secrets) | `{{ env.API_KEY }}` |

Reference order: `bind` overrides fixture overrides env. Missing variables
are a hard error at the moment of interpolation.

---

## 10. The `flow.*` namespace

Minimal flow control. Loops and conditionals are intentionally absent in v1.

### 10.1 `flow.wait`

Pause for a fixed duration. Used sparingly; prefer `widget.wait_for` with a
condition.

```jsonc
{ "kind": "flow.wait", "ms": 500 }
```

### 10.2 `flow.comment`

No-op for the engine. Surfaces in the report so humans / agents can
annotate intent.

```jsonc
{ "kind": "flow.comment", "text": "Verify the user can refresh without re-entering the city." }
```

---

## 11. Worked example

```jsonc
{
  "schema_version": 2,
  "id": "5b09b9b4-1f3f-4d29-9fa1-3b9f0e0f6a44",
  "name": "Weather widget renders Tokyo and refresh re-fetches",
  "description": "Cover the happy path: open the widget, see the temperature, click refresh, see a new render.",
  "setup": {
    "requires": { "tools": ["get_weather"] }
  },
  "fixtures": { "city": "Tokyo" },
  "steps": [
    {
      "kind": "widget.open",
      "tool": "get_weather",
      "args": { "city": "{{ fixtures.city }}" },
      "expect": {
        "isError": false,
        "structuredContent.temperature_c": { "type": "number" },
        "_meta.openai/outputTemplate": { "exists": true }
      },
      "bind": { "first_temp": "structuredContent.temperature_c" }
    },
    {
      "kind": "widget.expect",
      "expect": [
        { "kind": "no_runtime_errors" },
        { "kind": "no_csp_violations" },
        { "kind": "text", "contains": "{{ fixtures.city }}" },
        { "kind": "text", "matches": "\\d+°C" }
      ]
    },
    {
      "kind": "widget.click",
      "target": { "role": "button", "name": "Refresh" },
      "expect": {
        "kind": "triggers_mcp_call",
        "method": "tools/call",
        "match": { "params.name": "get_weather", "params.arguments.city": "{{ fixtures.city }}" },
        "within_ms": 1000
      }
    },
    {
      "kind": "widget.wait_for",
      "condition": { "type": "text", "value": { "matches": "\\d+°C" } },
      "timeout_ms": 2000
    },
    {
      "kind": "assert.tool_response",
      "method": "tools/call",
      "match_params": { "name": "get_weather" },
      "expect": {
        "structuredContent.temperature_c": { "type": "number" }
      }
    }
  ]
}
```

---

## 12. Implicit defaults catalog

Every action has implicit assertions that fire without explicit `expect`.
This is what makes Cues strict by default and sparse to write.

| Action | Implicit assertions |
|---|---|
| `mcp.call` | response received before timeout; `result.isError` not `true` |
| `mcp.notify` | none (notifications have no response) |
| `mcp.expect` | matching message arrives before timeout |
| `widget.open` | tool succeeds; widget reference present in response; render completes; `bodyChars > 0`; no runtime errors |
| `widget.click` | locator resolves to one element; click event dispatches |
| `widget.fill` | locator resolves; value written; element's `.value` reflects |
| `widget.wait_for` | condition holds before timeout |
| `widget.expect` | each listed expect entry passes |
| `assert.tool_response` | a matching call exists; `expect` passes against its result |
| `flow.wait` | none |
| `flow.comment` | none |

Authors override defaults by adding explicit `expect` entries. Defaults
never silently skip; a failure in any default fails the step.

---

## 13. Error model

Every failure has a structured shape so reports and CI can render it
consistently:

```jsonc
{
  "step_index": 3,
  "step_kind": "widget.click",
  "status": "fail",
  "reason": "selector-miss",
  "details": {
    "locator": { "role": "button", "name": "Refresh" },
    "tried": ["role+name", "css fallback"],
    "closest": [
      { "role": "button", "name": "Refesh" }   // typo found in DOM
    ]
  }
}
```

| Status | Means |
|---|---|
| `pass` | All assertions, implicit and explicit, passed. |
| `fail` | At least one assertion did not pass. |
| `skip` | Step did not run (e.g. abort or `flow.skip_if` later). |
| `error` | Engine couldn't run the step (translator error, network fault). Distinct from `fail`. |
| `timeout` | Step exceeded its timeout. |

Reports surface `reason` (short string) and `details` (action-specific
object). Translator errors are caught at file-load time and surfaced before
any step runs.

---

## 14. Engine integration

The mcp-studio engine consumes a Cue through this pipeline:

1. **Load** — read JSON from `~/.mcp-studio/tests/<slug>.json` or a project
   directory.
2. **Validate** — JSON Schema check against `schema/cue.v2.schema.json`.
3. **Translate** — convert each Cue step into one or more low-level Engine
   IR `Action` objects (e.g. `widget.open` → `mcp.request` + implicit
   render-wait; `widget.fill` → `widget.dom.input` + `widget.dom.change`).
4. **Run** — feed the IR through existing drivers, asserters, and report
   builder. No new driver or runtime introduced.
5. **Report** — render results in the same `TestResultModal` and write to
   `~/.mcp-studio/reports/`.

Recorder exports use the same translator in reverse: capture IR, run the
IR-to-Cue transform, write JSON. Round-trip parity is a correctness
property: `translate(reverse_translate(ir)) === ir` for any captured
session.

---

## 15. Out of scope for v1

Documented here so we don't repeatedly relitigate. Add to the spec when
real demand arrives.

- Widget actions: `widget.select`, `widget.press`, `widget.hover`,
  `widget.scroll`
- Widget assertions: `count`, `attribute`, `value`, `state`, `snapshot`,
  `hidden`
- Standalone assertions: `assert.tool_called` (call-history queries),
  `assert.no_unexpected_errors`
- Flow control: `flow.group`, `flow.skip_if`, conditional branches, loops
- Cue envelope: `tags`, `retry`, `teardown`
- Built-in interpolation functions: `now`, `uuid`, `random_int`
- External `$ref` JSON Schemas in matchers
- Visual snapshot comparison
- Per-step parallelism
- Cue composition (one Cue importing another)

---

## 16. Authoring guidance for AI agents

When writing Cues:

1. **Always declare `setup.requires.tools`** for tools the Cue calls.
   Saves a debugging round-trip when the Cue is run against a server
   that doesn't expose them.
2. **Prefer `widget.open` over raw `mcp.call`** when the Cue's intent
   is to render a widget. The implicit assertions are stronger.
3. **Prefer semantic locators** in this order: `text`, `role+name`,
   `label`, `testid`. Use `css` only when nothing else works.
4. **Write `expect` blocks as type-and-shape claims**, not exact-value
   claims. A weather Cue should assert `temperature_c` is a number,
   not that it equals `21.5`.
5. **Use `bind`** to thread server-generated IDs through multi-step
   Cues instead of hardcoding.
6. **Keep Cue scope small.** One scenario per file. Multiple scenarios
   = multiple files.
7. **Use `flow.comment`** liberally to record intent that a human
   reviewer will need.
8. **Default to `widget.expect.no_runtime_errors` and
   `widget.expect.no_csp_violations`** after every `widget.open`.
   Cheap insurance.

When converting recorded actions to a Cue:

1. **Collapse `mcp.request` + `mcp.response` pairs** into a single
   `mcp.call`. Lift any non-empty observed result into an `expect`
   `shape` matcher (subset, not strict equality).
2. **Collapse `widget.dom.input + widget.dom.change`** for the same
   target into a single `widget.fill`.
3. **Pick the best locator** from the recorded chain
   (`testid > role+name > label > text > css`) and emit it as the
   primary; emit the rest as a `chain` fallback ladder.
4. **Drop synthetic events** (`widget.render.complete`,
   `widget.render`) that are implied by the action that triggered them.
5. **Preserve any `csp.violation`** observed in the recording as an
   explicit allow-list in `widget.expect.no_csp_violations.allow`
   (future v2 field; for v1 just drop them).

---

## 17. Glossary

| Term | Means |
|---|---|
| Cue | A declarative test for an MCP server, in the format defined by this document. |
| Engine IR | mcp-studio's internal Action union the drivers consume. |
| Step | One entry in a Cue's `steps[]`. Has a `kind` and per-kind fields. |
| Locator | An object that identifies one element in the rendered widget. |
| Matcher | A value (literal or object) that describes how to test another value. |
| Path | Dot-syntax string identifying a field inside a JSON value. |
| Implicit assertion | A check that runs automatically without being declared. |
| Profile | A named MCP server target with auth. See `test-recorder-and-replay.md`. |
| Translator | The mcp-studio module that converts a Cue to Engine IR. |
| Recorder | The studio module that captures user interactions as IR. |
