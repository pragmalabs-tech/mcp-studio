# Test Recorder & Replay

How MCP Studio captures user interactions, turns them into named tests, and
replays those tests against a running MCP server.

---

## TL;DR

- Studio runs a small recorder bus from the moment the page loads. It
  silently captures everything the user does as a typed timeline of
  `Action` events.
- The user clicks **Record Test**, does stuff, clicks **Stop Record Test**.
  The slice between the two markers is named and written to disk as a JSON
  file at `~/.mcp-studio/tests/<slug>.json`.
- The user opens **Tests**, picks a saved test, clicks **Run**. Studio
  enters Test mode, the **Engine** drives the same store and iframe a
  real user would, and a **Report** opens showing per-step pass/fail with
  a sandboxed widget preview for visual proof.

The whole pipeline shares one type — the `Action` union in
`src/lib/recorder/schema.ts` — across capture, replay, and assertion.
Adding a new kind of action means one entry in three places.

---

## Goals

1. **Capture is invisible.** A user shouldn't have to think about what's
   "test-worthy" while doing it. The bus is always on; recording is just
   "I want this slice to be named and saved."
2. **Replay drives the real Studio.** No parallel codepath. The Engine
   calls the same store setters and `mcpCall` as a human does. If the
   real path breaks, replay breaks the same way.
3. **Files on disk, no DB.** Tests and reports are JSON files in
   `~/.mcp-studio/`. Git-friendly, user-editable, no migrations.
4. **Trivial assertions are derivable.** No assertion DSL. A response
   passes if it has no error. A render passes if the body has content
   and no runtime errors. A click passes if the DOM mutated. Everything
   else is observation.

## Non-goals (v1)

- **Visual / pixel diffing.** We capture DOM HTML snapshots, not PNGs.
- **Headless / CI replay.** The Engine runs inside Studio. There's no
  CLI-driven Playwright harness. Add later when there's demand.
- **Editable assertions per step.** Assertions are built into the
  per-kind table — no UI to override them.
- **Replay across schema versions.** A test JSON is keyed to
  `session.version: 1`; older versions are rejected at the backend.

---

## Mental model

```
┌────────── always-on bus ──────────┐
│ ▒▒▒░░░░░░▒▒▒▒░░░▒░▒▒▒░░░░░░░▒░░ │  ← every user action, captured
└──────┬───────────────────┬────────┘
       │                   │
   mark start          mark end                    sliced into a named Test
       │                   │                              │
       └────► slice ◄──────┘                              ▼
               │                              ~/.mcp-studio/tests/x.json
        name, save                                        │
                                                          │  Run
                                                          ▼
                                                      ┌────────┐
                                                      │ Engine │
                                                      └────────┘
                                                          │
                                                          ▼
                                              ~/.mcp-studio/reports/x-runId.report.json
```

A **Test** is just a `Session` (existing schema) plus a tiny header:

```ts
interface Test {
  id: string;            // uuid
  name: string;          // user-given
  description?: string;
  createdAt: string;     // ISO
  session: Session;      // the recorded slice
}
```

A **Session** has a setup snapshot (`connect`, `config`) and an ordered
`timeline: Recorded[]`. A **Recorded** is `{ relMs } & Action`.

The `Action` union is the only schema that matters. Everything else
(drivers, asserters, summarizers) is keyed off `Action["kind"]`.

---

## Architecture

### Three-layer capture

```
┌───────── Studio (browser) ─────────┐
│                                    │
│  React chrome  ──► Zustand subscriber ─┐
│                                        │
│  api.ts mcpCall ──► interceptor ───────┼──► Recorder bus ──► Action[]
│                                        │
│  iframe widget ──► recorder-bridge.js ─┘
│                                                │
│                                            buffer
│                                                │
│                                          Tests, Reports
└────────────────────────────────────────────────┘
```

| Layer | What it captures | File |
|---|---|---|
| **Chrome** | platform, theme, locale, viewport, auth, sidebar selection, editor args | `src/lib/recorder/instrumentation.ts` |
| **MCP boundary** | every `tools/call`, `resources/read`, `prompts/get` and their responses | `src/lib/recorder/mcp-interceptor.ts` |
| **Widget DOM** | every click, input, change, submit, keydown inside the iframe; render-complete; widget intents (postMessage out) | `src/widget-bridge/recorder-bridge.js` |

The **bus** (`src/lib/recorder/bus.ts`) is the only piece that knows about
timing, ordering, redaction, and the `Session` schema. The three layers
emit; the bus orders and persists.

### Widget iframe lifecycle (record + replay symmetric)

The iframe `WidgetFrame` (`src/lib/core/views/widget-frame.tsx`) mounts
once per widget URL. After that, mock updates flow into the live
iframe via `postMessage`, not by recomputing `srcdoc`:

```
parent                              iframe
─────────                           ─────────
applyWidgetMock(name, mock)
   │
   ├─ store.set({currentMock})
   │
   ├─ if first widget URL:          srcdoc loads
   │    await render.complete  ◄──── bridge install + render.complete
   │                                  ┌───────────────────────┐
   │                                  │ mock-openai script    │
   ├─ else (same widget):             │ defines window.openai │
   │    wait 2 RAFs (~32ms)           │ + listens for         │
   │                                  │ mcpr_set_mock         │
   │                                  └───────────────────────┘
   │
   │   WidgetFrame useEffect[mock]
   ├─►  iframe.postMessage(
   │      { type: "mcpr_set_mock", mock }
   │    )                            ──► mock-openai handler:
   │                                       __toolInput = mock.toolInput
   │                                       __toolOutput = mock.toolOutput
   │                                       __widgetState = mock.widgetState
   │                                       window.dispatchEvent(
   │                                         openai:set_globals
   │                                       )
   │                                     ──► React widget re-renders
   │
   │   iframe.onload also re-sends the
   │   current mock to cover the race where
   │   the effect fires before scripts ran.
```

Bridge installs ONCE per iframe mount. The `__mcprRecorderInstalled`
flag prevents duplicate installs. The bridge stays alive across mock
updates, so DOM event listeners and the message handler don't get
wiped.

Debug: set `window.__mcprDebug = true` in the iframe context (or top
frame) to enable verbose `[mcpr]` / `[bridge]` logs. Bridge logs are
piped to the parent window so they show up regardless of console
context filter. Off by default.

### Three-driver replay

```
                 ┌────────── Engine ──────────┐
                 │ state machine over timeline │
                 └─┬─────────┬──────────┬─────┘
                   │         │          │
                   ▼         ▼          ▼
              Chrome     MCP driver   Widget driver
              driver
                   │         │          │
                   ▼         ▼          ▼
             store setters mcpCall   bridge.dispatch
             store.execute()         bridge.snapshot()
                                     bridge.awaitRenderComplete()
```

| Driver | Action kinds it handles | What it does |
|---|---|---|
| **Studio** | `studio.select`, `studio.set_args`, `studio.set_config`, `studio.set_mock` | Calls the matching live store setter. Pure state mutations. |
| **MCP** | `mcp.request` | For `source: "user"` or `"engine"`, the engine dispatches via `mcpCall(method, params)` — a real MCP call. For `source: "widget"`, treated as observation; the widget will or won't fire it as a side effect. Responses are observed via `mcpAttach`, not driven. |
| **Widget** | `widget.opened`, `widget.runtime_error`, `widget.render`, `widget.intent`, `widget.dom.*` | `widget.render` calls `store.applyWidgetMock` (pure setter + emit). On a different widget name from the previous step, the engine awaits `bridge.awaitRenderComplete` (first mount). Same-widget mock updates wait two animation frames for React to commit. DOM events use `bridge.dispatch(action)` with a 2s selector retry. `widget.intent` is observed via `widgetAttach`, not driven. |

The **Engine** (`src/lib/engine/engine.ts`) doesn't know about MCP, the
store, or the iframe. It walks the timeline, picks a driver per action by
its `kinds` field, awaits with timeout, asserts via the per-kind table.
Everything is injected via `EngineDeps`.

---

## The `Action` schema (the contract)

Defined in `src/lib/recorder/schema.ts`. Categorized by what they do:

### Pure inputs (driven by the Engine; replay re-issues them)

| Kind | Fields | Driver |
|---|---|---|
| `sidebar.select` → `studio.select` | `selection: { type, name }` | studio |
| `editor.set_args` → `studio.set_args` | `value` (any JSON) | studio |
| `config.update` → `studio.set_config` | `patch: Partial<StudioConfig>` | studio |
| `widget.mock.set` → `studio.set_mock` | `value` | studio |
| `widget.render` → `widget.render` | `name`, `mock` ({toolInput, toolOutput, meta, widgetState}) | widget — applies mock via store + postMessage |

### MCP boundary (mixed)

| Kind | Fields | Behavior |
|---|---|---|
| `mcp.request` | `id`, `source: "user"\|"widget"`, `method`, `params` | user → driven via `execute()`; widget → observation |
| `mcp.response` | `requestId`, `result?`, `error?`, `durationMs` | observation; paired by `requestId` |
| `mcp.notification` | `method`, `params` | observation |

### Widget side (driven by the bridge)

| Kind | Fields | Driver |
|---|---|---|
| `widget.render` | `name`, `htmlHash`, `initialMock` | widget — awaits `render.complete` |
| `widget.render.complete` | `bodyChars`, `hasRuntimeErrors`, `handshakeOk`, `renderDurationMs` | observation; emitted by the bridge when the iframe finishes loading |
| `widget.intent` | `name`, `params` | observation; widget posted a non-tool message (`ui/openLink`, `ui/setState`, etc.) |
| `widget.dom.click` | `selectors`, `mutated` | widget — bridge dispatches synthetic `MouseEvent` |
| `widget.dom.input` | `selectors`, `value`, `inputType` | widget — bridge sets `.value` then fires `InputEvent` |
| `widget.dom.change` | `selectors`, `value` | widget — same as input but `change` |
| `widget.dom.submit` | `selectors` | widget — bridge dispatches `submit` on the form |
| `widget.dom.keydown` | `selectors`, `key`, `code`, `mods` | widget — bridge dispatches `KeyboardEvent` |

### Observations only (player skips with explanation)

| Kind | Fields |
|---|---|
| `csp.violation` | `directive`, `blockedUri`, `severity` |

### Selector chain (used everywhere DOM is referenced)

`SelectorChain` captures multiple ways to find the same element so replay
is resilient to DOM tweaks:

```ts
interface SelectorChain {
  testid?: string;             // preferred
  aria?: { label?, role? };
  text?: { tag, value };       // visible text + tag (button/link/etc.)
  css?: string;                // short path scoped to nearest id ancestor
  xpath?: string;              // last resort
}
```

The bridge's `resolveSelectorChain` tries each tier in order; first hit
wins. The recorder captures **all** tiers at record time; the engine
picks the most resilient at replay time.

---

## Bridge protocol — bidirectional

Defined in `src/lib/recorder/bridge-protocol.ts`. All messages share an
envelope `{ __recorder: true, ... }` posted via `window.postMessage`.

### Outbound (iframe → host)

| Op | When | Payload |
|---|---|---|
| capture event (no `op` tag) | every user click/input/change/submit/keydown | `{ kind: "widget.dom.*", selectors, ... }` |
| `render.complete` | after iframe `load` + 2× rAF | `{ bodyChars, hasRuntimeErrors, handshakeOk, renderDurationMs }` |
| `ack` | reply to inbound dispatch / ping / snapshot | `{ id, ok, mutated?, reason? }` |
| `snapshot.result` | reply to inbound snapshot | `{ id, html, errors[] }` |

### Inbound (host → iframe; replay only)

| Op | When | Payload |
|---|---|---|
| `dispatch` | Engine wants to replay a DOM event | `{ id, action }` |
| `ping` | Health check | `{ id }` |
| `snapshot` | Capture current DOM | `{ id }` |

The bridge is a single self-contained JS file
(`src/widget-bridge/recorder-bridge.js`) imported via Vite's `?raw` so it
inlines into the iframe srcdoc with no separate build step. The
host-side counterpart is `BridgeClient`
(`src/lib/engine/bridge-client.ts`) which:

- holds a monotonic id counter and a `Map<id, pending>` for dispatch acks
  and snapshot replies
- caches the most recent `render.complete` for 3s so a late
  `awaitRenderComplete` resolves immediately (covers the
  `execute()→renderWidget→iframe load` chain timing)

---

## Recording flow

1. `store.ts` calls `recorder.start(snapshotSetup(...))` once at module
   load. The bus snapshots the current `connect` (URL, auth) and `config`
   (platform, theme, viewport, etc.).
2. Three layers emit:
   - **Chrome subscriber** (`instrumentation.ts`): subscribed to a
     **whitelist** of store paths. On change, diffs and emits
     `config.update` / `auth.update` / `sidebar.select` /
     `editor.set_args`. Editor edits are debounced 300ms idle and
     force-flushed before any `mcp.request`. Skips emission while
     `studioMode === "test"` (so the Engine's setters don't get
     re-captured).
   - **MCP interceptor** (`mcp-interceptor.ts`): wraps every
     `mcpCall` with id-paired emit/await/emit. `callTool` and
     `readResource` carry a `source` arg; the widget tool-call closure
     in `renderWidget` passes `"widget"`, everything else is `"user"`.
   - **Widget bridge** (`recorder-bridge.js`): document-level capture
     listeners on click/input/change/submit/keydown. After each event
     waits 2 rAFs, hashes `document.body.innerHTML`, and only emits if
     mutated (or always for keydown). Selectors are built lazily.
3. The user clicks **Record Test**. UI sets
   `slicingState = { startIndex: recorder.markIndex(), startedAt }`.
   The History dialog renders a colored gutter on rows ≥ `startIndex`.
4. The user does stuff. The bus keeps emitting normally — slice marker
   is purely UI bookkeeping; no behavior changes.
5. The user clicks **Stop Record Test**. UI calls
   `recorder.markIndex()` for `endIndex`, opens the Save modal with the
   slice preview.
6. On save, `recorder.serializeRange(start, end)` builds a `Session`
   from `buffer.slice(start, end)`, redacts auth tokens to
   `"<<from-env>>"`, and `newTest({...})` wraps it. POST to
   `/api/studio/tests/{slug}` writes
   `~/.mcp-studio/tests/<slug>.json`.

### What gets redacted

`bus.ts:redactRecorded` walks every `auth.update` entry and
replaces `token` fields with `"<<from-env>>"`. Setup-time tokens are
redacted by `redactSetupConnect` before the session is finalized.
**Custom-headers auth is NOT redacted** — header values can contain
tokens; the user is responsible for sanitizing them before sharing.

---

## Replay flow

1. User opens **Tests** drawer (folder icon), clicks **Run** on a row.
2. `tests-page.tsx` fetches the test, checks `strictMode` precondition
   (the bridge can't run under strict CSP). If strict is on and the
   test has any `widget.dom.*` steps, opens
   `<TestPreconditionDialog />` — user clicks "Disable strict CSP & Run"
   or "Cancel".
3. `tests-page.tsx` constructs a Engine:
   ```ts
   createEngine({
     store: makeEngineStore(),                // adapter over useStudioStore
     iframe: () => useStudioStore.getState()._iframeRef,
     bridge: createBridgeClient(...),
     drivers: [chromeDriver, mcpDriver, widgetDriver],
     artifacts: createArtifactCollector(),
   });
   ```
4. `engine.run(test)`:
   1. `recorder.suspend()` — bus stops persisting to the buffer but
      **listeners still fire** (so the Engine can observe
      `mcp.response` / `widget.render.complete` from the bus).
   2. `setStudioMode("test")` — `<TestModeOverlay />` mounts a
      full-screen blocking layer with the step counter and a Stop
      button.
   3. `applySetup(test, store)` — applies `connect` URL/auth and
      `config` (platform/theme/locale/viewport).
   4. For each `Recorded` in `timeline`:
      1. Pick a driver by `kinds.includes(action.kind)`.
      2. If no driver, mark `skip` with a reason from
         `skipReasonForKind`.
      3. Run driver under `withTimeout(promise, timeoutFor(kind))`.
         Per-kind timeouts in `src/lib/engine/timing.ts`.
      4. Look up `ASSERTERS[action.kind]` and produce a
         pass/fail/skip status with a reason.
      5. On `fail`/`timeout`, call `bridge.snapshot(1000)` and pass to
         `artifacts.recordFailure`. On `pass` for `widget.render`, also
         capture a 500ms-budget snapshot via
         `artifacts.recordPreview` so the report can show a visual.
      6. Wait `stepDelayMs` (default 150ms) so a human watcher can
         follow along.
   5. `setStudioMode("normal")`, `recorder.resume()`, return the
      `RunResult`.
5. `tests-page.tsx` wraps the `RunResult` + artifacts in a
   `ReplayReport` (`buildReport({...})`) and opens
   `<TestResultModal />`.

### Sync strategy — event-driven, not wall-clock

`relMs` in the recorded timeline is **diagnostic only**. The Engine
never sleeps for a recorded duration. Instead, each input awaits the
**natural follow-up observation**:

| After… | Engine awaits… |
|---|---|
| `mcp.request` (user) → execute() | the next `mcp.response` on the bus |
| `widget.render` step | the next `render.complete` from the bridge (or the cached one if recent) |
| `widget.dom.*` dispatch | the bridge `ack` keyed by request id |

If the awaited event doesn't arrive within the per-kind timeout, the
step fails with reason `"step timed out"`. The next step proceeds —
we don't bail the whole run on one timeout.

**Listener-before-trigger.** The single biggest source of bugs in early
versions was registering observation listeners *after* triggering the
action that emits them. Fixed by always registering first:

```ts
// mcp.ts driver — correct ordering
const responsePromise = ctx.onObservation(predicate, timeout);
await ctx.store.execute();   // emits response synchronously inside callTool
observation = await responsePromise;
```

---

## Assertions

`src/lib/engine/asserter.ts` is a **table** keyed by action kind. Pure
functions. No state. No inheritance. Add an asserter = add a table
entry.

| Kind | Pass criterion | Fail mode |
|---|---|---|
| `mcp.request` | observation has no `error` field | error message from response |
| `widget.render` | observation has `bodyChars > 0` and `!hasRuntimeErrors` | "empty body", "runtime error in widget" |
| `widget.dom.click` | bridge ack `ok && mutated === true` | "DOM did not mutate" or selector miss |
| `widget.dom.change` | same as click | same |
| `widget.dom.input` | bridge ack `ok` (mutation optional — typing in an input often doesn't mutate body chars) | selector miss / dispatch error |
| `widget.dom.submit` | bridge ack `ok` (mutated optional — `preventDefault` is fine) | selector miss |
| `widget.dom.keydown` | bridge ack `ok` (informational — fail only if selector is unresolvable) | selector miss |
| pure inputs | always pass when driver returns `ok` | driver setter threw |

Observations (`mcp.response`, `mcp.notification`,
`widget.render.complete`, `widget.intent`, `csp.violation`) get
`status: "skip"` with a human reason from `skipReasonForKind`.

The asserters are intentionally lenient — pass if the live system
behaved similarly, not if the result is bit-identical. Strict-mode
assertions (deep equal on `mcp.response.result`) are a future
extension; the data is already in the report for offline diffing.

---

## Storage — files on disk

Two directories under `~/.mcp-studio/`:

```
~/.mcp-studio/
├── config.json                    (existing)
├── tests/
│   └── search-flow.json           (Test JSON; one per test)
└── reports/
    └── search-flow-3a7c2d8b.report.json   (one per run)
```

Both directories are managed by the Rust backend, not the browser:

| HTTP | Path | Behavior |
|---|---|---|
| `GET` | `/api/studio/tests` | List with summary metadata lifted from each file |
| `GET` | `/api/studio/tests/{slug}` | Full Test JSON |
| `PUT` | `/api/studio/tests/{slug}` | Validate + write |
| `DELETE` | `/api/studio/tests/{slug}` | Remove file |
| `GET` | `/api/studio/reports` | List with summary (test, runId, pass/fail counts) |
| `GET` | `/api/studio/reports/{slug}` | Full report JSON |
| `PUT` | `/api/studio/reports/{slug}` | Write (no DELETE — reports are append-only history) |

### Filename safety (`src/storage.rs:safe_filename`)

The slug returned to the user is sanitized:
- lowercased, only `[a-z0-9_-]`
- whitespace becomes `-`, repeats collapsed
- empty → `"untitled"`, capped at 64 chars
- traversal characters (`/`, `..`) silently stripped

The handlers reject any incoming `name` that doesn't already match its
own slug. This rules out path traversal attacks and confusing aliasing.

### Why files, not a DB

- Git-friendly: drop the `tests/` folder into a repo and you have shared
  team tests.
- User-editable: open in an editor, tweak args, save.
- No migrations: the schema *is* the file.
- Backend already manages `~/.mcp-studio/config.json`; adding two
  sibling directories is a 60-line addition.

The cost is no transactional integrity (concurrent writes could
clobber). For a single-user dev tool, fine.

---

## Reports & artifacts

`ReplayReport` (`src/lib/engine/report.ts`):

```ts
interface ReplayReport {
  version: 1;
  runId: string;          // uuid
  test: { name, description?, totalActions };
  summary: { passed, failed, timeout, skipped, total };
  preconditions: { strictModeOk, iframeReady };
  steps: StepResult[];    // per-step status + observation
  artifacts: {
    failures: Record<index, { domSnapshot, errors[], contextWindow[] }>;
    previews: Record<index, { domSnapshot }>;   // success snapshots for widget.render
  };
  env: { userAgent, viewport, studioVersion };
  startedAt, finishedAt, durationMs;
}
```

### What `<TestResultModal />` renders per step

A row consists of:

```
[ #N ] [ ✓ / ✗ / ⊝ ] [ duration ]  [ kind ]   [ verbalize(action) → live summary ]
```

Where:
- `kind` is the raw action kind (e.g. `mcp.request`) shown small.
- `verbalize(action)` is a verb-first sentence: "Call tools/call →
  get_weather (user)", "Click [Submit]", "Render widget: weather-app".
  See `src/lib/recorder/summarize.ts:verbalize`.
- `live summary` is the headline of what actually happened during
  replay: `→ ok · 412 chars · 14ms`, `→ DOM mutated`, `→ no
  handshake`. Built by `liveSummary(step)` in
  `test-result-modal.tsx`.

Click to expand. Always shows (no nested toggles):

1. **Rendered preview** — only for `widget.render` rows with a captured
   preview snapshot. Renders the DOM HTML in
   `<iframe sandbox="" srcDoc={html}>` — empty sandbox means scripts
   *don't* run, so the preview is a static visual snapshot. ~3-5KB per
   render in the report file.
2. **Recorded action** — pretty-printed JSON of the original `Action`.
3. **Live observation** — pretty-printed JSON of what came back during
   replay (response, ack, render-complete, etc.).
4. **DOM at failure** — only on fail/timeout, with the bridge's full
   `documentElement.outerHTML` (truncated at 5000 chars for display)
   plus any captured `window.error` messages.

### Why DOM snapshots, not pixel screenshots

- DOM HTML is text-diffable across runs.
- DOM snapshots are small (5-10KB typical, 50KB worst case).
- A DOM snapshot rendered in a `sandbox=""` iframe gives 95% of the
  visual proof of a PNG screenshot at 1% of the storage cost.
- Capturing PNGs requires `html2canvas` (heavy) or browser native
  screenshot APIs (not exposed to web pages). Skipped for v1.

If we add PNGs later, the natural slot is the bridge's
`op: "snapshot"` handler, returning `{ html, png }` alongside.

---

## Studio modes — Normal vs Test

`studioMode: "normal" | "test"` lives in the studio store
(`src/lib/studio/store.ts`).

| Mode | UI | Recorder | Engine |
|---|---|---|---|
| `normal` | Interactive | Capturing | Idle |
| `test` | Blocked by `<TestModeOverlay />` | `recorder.suspend()` (listeners fire, buffer push skipped) | Driving |

The overlay is a `pointer-events: auto` full-screen layer with
capture-phase event handlers that swallow every click and keydown. The
underlying Studio is dimmed but visible — essential for debugging a
failing test.

The Engine calls store setters directly via the `EngineStore` adapter
(`makeEngineStore`) which closes over `useStudioStore.getState()` for
every call. The setters work because they don't go through DOM events
— the overlay only blocks the user, not programmatic state changes.

### Strict CSP and the bridge

The bridge script can't run under strict CSP. Three implications:

1. The recorder's widget-DOM layer degrades gracefully when strict CSP
   is on — chrome and MCP events still flow, but `widget.dom.*` events
   are not captured.
2. Replay of a test with any `widget.dom.*` step requires strict CSP
   off. Enforced by the precondition gate
   (`<TestPreconditionDialog />`) — "Disable strict CSP & Run".
3. Failure DOM snapshots and success previews require the bridge, so
   they're only available when strict CSP is off.

The user controls strict mode; the recorder/replay never silently
toggles it.

---

## What lives where

```
mcp-studio/
├── src/
│   ├── storage.rs              path resolver + safe_filename + JSON I/O
│   ├── tests_api.rs            HTTP handlers for /api/studio/tests
│   ├── reports_api.rs          HTTP handlers for /api/studio/reports
│   └── server.rs               registers routes, AppError variants
└── frontend/src/
    ├── lib/recorder/
    │   ├── schema.ts           THE Action union; Test/TestSummary types
    │   ├── bus.ts              Recorder singleton; suspend/resume; serializeRange
    │   ├── instrumentation.ts  Zustand subscriber (chrome layer)
    │   ├── mcp-interceptor.ts  recordedMcpCall (MCP layer)
    │   ├── bridge-protocol.ts  message envelope types
    │   ├── selector.ts         buildSelectorChain + resolveSelectorChain
    │   ├── summarize.ts        summarize() / verbalize() / skipReasonForKind
    │   └── export.ts           downloadSession Blob helper
    ├── lib/engine/
    │   ├── engine.ts           state machine over the timeline
    │   ├── bridge-client.ts    host-side dispatcher with render.complete cache
    │   ├── asserter.ts         per-kind ASSERTERS table
    │   ├── timing.ts           per-kind TIMEOUTS
    │   ├── artifacts.ts        ArtifactCollector (failures + previews)
    │   ├── report.ts           buildReport + reportFilename
    │   ├── runtime.ts          live progress singleton (overlay subscribes)
    │   ├── make-store.ts       EngineStore adapter over useStudioStore
    │   └── drivers/
    │       ├── types.ts        Driver interface, DriverContext
    │       ├── chrome.ts       chromeDriver — config/auth/sidebar/editor
    │       ├── mcp.ts          mcpDriver — execute() for user, observe for widget
    │       └── widget.ts       widgetDriver — bridge dispatch + render.complete
    ├── lib/tests/
    │   ├── format.ts           newTest() factory + slugify
    │   ├── api.ts              fetch wrappers for /api/studio/tests
    │   └── reports-api.ts      fetch wrappers for /api/studio/reports
    ├── widget-bridge/
    │   └── recorder-bridge.js  iframe-side bidirectional bridge
    └── components/studio/
        ├── recording-history-dialog.tsx   live timeline viewer
        ├── save-test-modal.tsx            name + description + save
        ├── tests-page.tsx                 catalog: list, run, expand actions
        ├── test-mode-overlay.tsx          full-screen blocker during replay
        ├── test-precondition-dialog.tsx   strict-CSP gate
        └── test-result-modal.tsx          run report viewer
```

---

## Trade-offs and limitations (read before extending)

### `serializeRange` uses current setup, not setup at slice start
If the user changes platform/theme/auth mid-session and then slices
something earlier, the saved `setup` reflects the *current* values,
not the values when the slice was being captured. Acceptable because
setup rarely changes mid-session; if it bites real users, capture a
copy of `setupSnapshot` at `markIndex` time and store per-marker.

### Selector resilience degrades to xpath
Widgets that use generated CSS class names with no
`data-testid` / `aria-label` / visible text fall back to xpath, which
breaks if the DOM tree shape changes. Document this in the Tests UI:
"If a widget's DOM changes, re-record the test."

### Engine skips widget-source `mcp.request`
Recorded `mcp.request` with `source: "widget"` happen as a side effect
of widget code. The Engine can't deterministically force them. They're
treated as observations (always pass). If a widget *stops* making a
recorded call during replay, the test won't catch it — but the next
*user-driven* step that depended on the result will surface the
divergence.

### No transactional integrity in file storage
Two concurrent saves to the same `tests/<slug>.json` will race. For a
single-user local tool, fine. If we ever add cloud sync or
multi-window editing, switch to write-rename atomicity.

### Inter-step delay is fixed at 150ms
Hard-coded default in the engine; configurable via `stepDelayMs` in
`EngineDeps` but not exposed in the UI. When we add a "headless mode"
toggle (e.g. for fast-iteration retries during dev), wire that toggle
to `stepDelayMs: 0`.

### Render preview iframe sandbox is empty
`<iframe sandbox="" srcDoc={html}>` runs no scripts, so animations,
images loaded via JS, and any CSS that depends on JS won't render.
For "did the basic structure come out right?" this is sufficient. For
exact visual fidelity, you'd need to render with the bridge re-enabled
*and* mocks injected — which means re-running the widget, which is
what replay already does.

### Reports keep growing
No DELETE on `/api/studio/reports`. By design — a report is run history.
Add a "prune > N days" mechanic in `storage.rs` if it becomes a
problem.

---

## End-to-end smoke test

```bash
cd mcp-studio && cargo run            # backend on :7777
cd mcp-studio/frontend && pnpm dev
```

1. Open the Studio in a browser. Pick a tool that returns a widget.
2. **Record Test** in the top header. (First time: explainer dialog;
   click "Start recording".)
3. Drive Studio — pick the tool, edit args, Execute. Watch the widget
   render. Click something inside the widget. Type into an input.
4. **Stop Record Test**. Save modal appears, name it
   `smoke-test`. Save.
5. Confirm `~/.mcp-studio/tests/smoke-test.json` exists.
6. Open the **Tests** drawer (folder icon). `smoke-test` appears.
   Click the chevron to expand — you see the action list.
7. Click **Run**. If strict CSP is on, precondition dialog appears.
   Disable & Run.
8. Test mode overlay appears, dims the UI, ticks through steps with
   ~150ms between each. Result drawer opens with all-green.
9. Expand a `widget.render` row in the report — see the **rendered
   preview** iframe with the actual widget output.
10. Click **Export** → downloads `smoke-test-<runId>.report.json`. Or
    **Save to disk** → POSTs to backend, file lands in
    `~/.mcp-studio/reports/`.

If a step fails:
- The row is red with the failure reason inline.
- Expand it: the **DOM at failure** section shows the iframe's
  `outerHTML` at the moment of failure plus any
  `window.onerror` messages.

---

## Adding a new action kind — checklist

1. **Schema** (`src/lib/recorder/schema.ts`):
   - Add the variant to the `Action` union.
   - Add the kind string to `ALLOWED_KINDS`.
2. **Capture** — wherever the event originates:
   - Chrome: add the path to `RECORDED_PATHS` in
     `instrumentation.ts` and emit in the diff branch.
   - MCP: usually doesn't need new kinds; the interceptor handles all
     methods generically.
   - Widget: add a new `BridgeMessage` shape in
     `bridge-protocol.ts`, capture in `recorder-bridge.js`, forward
     in `mock-claude.ts`.
3. **Driver** (if it's an input):
   - Pick chrome / mcp / widget driver and add the kind to its
     `kinds` array; handle the case in `drive()`.
4. **Asserter** (`src/lib/engine/asserter.ts`):
   - Add an entry to `ASSERTERS` if the kind has a meaningful
     pass/fail. Otherwise it'll fall through to `passThrough` (pass
     when driver returned ok).
5. **Summarize** (`src/lib/recorder/summarize.ts`):
   - Add cases to `summarize()` and `verbalize()` so the History
     dialog and Report show readable text.
6. **Tests** — extend `schema.test.ts`, `asserter.test.ts`,
   relevant driver tests.

The contract is small enough that all six places can be updated in
one short PR.
