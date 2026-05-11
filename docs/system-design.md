# mcp-studio system design

A record/replay testing tool for MCP widgets. Captures user actions as an
event stream, replays them through the same drivers, and asserts that
the resulting state matches.

## The one rule

```
state(n) = apply(state(n-1), action(n))
```

Three nouns: **Action**, **State**, **Trace**. One verdict: pairwise
`State` diff between the recorded trace and the replayed trace.

## End-to-end flow

```
┌──────────────────────── RECORD ────────────────────────┐
│                                                        │
│  user interacts (select / set_args / callTool / ...)   │
│      │                                                 │
│      v                                                 │
│  recorder/bus emits Recorded[]                         │
│      │                                                 │
│      v                                                 │
│  trace-io.toTrace(timeline)                            │
│      │  - legacyToAction() maps each kind to Action    │
│      │  - foldTrace() fills stateAfter per step        │
│      v                                                 │
│  Trace { schemaVersion, steps[], initialState, setup } │
│      │                                                 │
│      v                                                 │
│  trace-io.saveTrace() -> JSON on disk                  │
└────────────────────────────────────────────────────────┘

┌──────────────────────── REPLAY ────────────────────────┐
│                                                        │
│  trace-io.loadTrace(json) -> Trace                     │
│      │                                                 │
│      v                                                 │
│  engine.run(trace, { drivers, signal, awaitMs }):      │
│      for each expected step:                           │
│        if action.source in {user, engine}:             │
│            driver.dispatch(action)        // drive     │
│        else: // source in {widget, server}             │
│            wait for ambient match or timeout           │
│        state = applyAction(state, action)              │
│        push { relMs, action, stateAfter: state }       │
│      │                                                 │
│      v                                                 │
│  Trace' (same shape, fresh stateAfter)                 │
└────────────────────────────────────────────────────────┘

┌──────────────────────── DIFF ──────────────────────────┐
│                                                        │
│  differ.diff(recorded, replayed, volatilePaths):       │
│      pair steps by index                               │
│      walk stateAfter leaves                            │
│      emit Drift on disagreement; skip volatile paths;  │
│      skip carry-overs (drift already reported earlier) │
│      │                                                 │
│      v                                                 │
│  Verdict { ok, drifts[] }                              │
└────────────────────────────────────────────────────────┘
```

## Layering

One-way dependencies. Lower layers must not import from higher.

```
LIVE GLUE          lib/studio/store.ts, lib/recorder/*, components/*
  | uses
UI COMPONENTS      lib/core/views/{trace-modal, widget-frame,
  |                                content-dialog, csp-findings}
  | uses
PURE COMPOSITION   lib/core/{engine, fold, differ, registry, trace-io,
  |                          widget/render-html, widget/inject}
  | uses
PURE PRIMITIVES    lib/core/{types, csp/{analyze, profiles, types,
                              restricted-apis, sandbox-trap}}
```

Rules:

- Pure primitives import only siblings + `types.ts`.
- Pure composition imports primitives; no DOM, no fetch, no store.
- UI components import composition + primitives; no store imports.
- Live glue may import any layer below; views never import glue.

The single glue boundary is `lib/core/runtime.ts`. It wires live deps
(zustand store, recorder bus, MCP client, iframe bridge) into a
`Driver[]` the engine can run.

## Driver model

Each driver owns a slice of `State` and implements:

| Field            | Purpose                                                  |
| ---------------- | -------------------------------------------------------- |
| `id`             | Routes Actions via `action.driver`.                      |
| `initialSlice()` | Seeds the State slice this driver owns.                  |
| `apply(s, a)`    | Pure transition - returns next State.                    |
| `volatilePaths`  | Glob-like paths the differ ignores (ids, timestamps).    |
| `dispatch(a)?`   | Live execution (engine drive path).                      |
| `attach(emit)?`  | Subscribe to ambient events (engine await path).         |

Slice ownership today:

| Driver   | Owns                                          |
| -------- | --------------------------------------------- |
| `studio` | `state.studio` (selected, args, mock, config) |
| `mcp`    | `state.tools` + writes `state.network`        |
| `widget` | `state.widgets` + writes `state.network`      |

Drivers may read any slice; they may only **write** the ones they own.

## Surfaces (where pieces plug in)

```
                       lib/core/views/
                              ▲
                              │ mounts
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   live studio          replay viewer        content dialog
   (widget-preview)     (trace-modal)        (content-dialog)
        │                     │                     │
        │                     │                     │
   WidgetFrame +         StepRow list +        WidgetFrame OR
   ExtAppsMock           WidgetPane +          pretty JSON +
                         CspFindingsList       CspFindingsList
```

All three surfaces consume the same `<WidgetFrame>` and
`<CspFindingsList>`. None of them owns iframe state directly;
`WidgetFrame` renders the iframe and forwards events via callback props.

## Recorder bus & engine ↔ live coupling

```
mcp-interceptor → recorder.emit("mcp.request" / "mcp.response")
applyMock       → recorder.emit("widget.mock.set")
sidebar select  → recorder.emit("sidebar.select")
widget bridge   → recorder.emit("widget.dom.click" / "input" / ...)
                       │
                       v
                 recorder/bus
                       │
            ┌──────────┼──────────┐
            v                     v
       store.actions[]    engine.attach() listeners
                          (during replay)
```

The bus is the single source of truth for "what happened". During
record it's drained into `Trace.steps`. During replay it's drained
into `engine`'s ambient queue so widget/server events can be matched
against expected steps.

## File map (quick reference)

| Path                              | Role                                  |
| --------------------------------- | ------------------------------------- |
| `core/types.ts`                   | Action / State / Trace / Verdict      |
| `core/registry.ts`                | Driver registry + initial state       |
| `core/drivers/{studio,mcp,widget}`| Apply + dispatch + attach per driver  |
| `core/fold.ts`                    | `applyAction`, `foldTrace`            |
| `core/engine.ts`                  | Replay loop (drive vs await)          |
| `core/differ.ts`                  | Pairwise State diff                   |
| `core/trace-io.ts`                | Load / save / migrate                 |
| `core/runtime.ts`                 | Glue: live deps -> `Driver[]`         |
| `core/widget/inject.ts`           | Head-injection mechanics              |
| `core/widget/render-html.ts`      | Compose widget srcdoc                 |
| `core/csp/analyze.ts`             | Static CSP scanner                    |
| `core/csp/profiles.ts`            | Platform profiles + meta extract      |
| `core/csp/sandbox-trap.ts`        | Runtime trap script                   |
| `core/views/widget-frame.tsx`     | Sandboxed iframe component            |
| `core/views/trace-modal.tsx`      | Replay viewer (steps + widget pane)   |
| `core/views/content-dialog.tsx`   | Fullscreen widget / JSON viewer       |
| `core/views/csp-findings.tsx`     | Severity-grouped findings list        |
