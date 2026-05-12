# Changelog

All notable changes to mcp-studio. Format roughly follows Keep a Changelog;
versions correspond to release tags in git.

## [Unreleased]

### Added
- **Per-test tag system.** Tag tests in the catalog (e.g. `smoke`, `auth`,
  `study-kit`) and filter the list by tag. Tags are stored on the trace's
  `tags?: string[]` field and surface in `TestSummary` for catalog UX.
- **Per-step compare mode (`exact` vs `shape`).** Flip any step from exact
  comparison to shape-only via the result modal's Compare control. Shape
  mode asserts JSON structure (types + key presence) and ignores leaf
  values + array lengths — the fix for env-flaky tool responses (UUIDs,
  timestamps, generated content).
- **Widget intent action (`widget.intent`).** Widget → host messages
  (`sendFollowUpMessage`, `setWidgetState`, `openExternal`, `ui/message`,
  `ui/open-link`, etc.) are now first-class actions. They append to
  `state.widgets.intents[]`, so tests can assert which intents fire and
  in what order.
- **Widget render action (`widget.render`).** What was previously a side
  effect of `store.execute()` is now an action with `{widgetName, mock}`
  payload. State cell `state.widgets.activeRender` records what data
  the widget was rendered against; the differ asserts on it.
- **View Rules dialog** on every test row. Inspect and edit the
  per-trace `ignore` / `match` rules without running the test first.
- **Step-by-step replay** with a top-header overlay. Replay shows a
  live progress bar, current action, and Next / Auto / Stop controls.
  Engine adds `onStepStart`, `onStepDone`, and `beforeStep` hooks.
- **Action descriptions in the catalog** (and richer expectation hints):
  `mcp.request` shows `call get_course { course_id }`; `mcp.response`
  shows `get_course → ok (143ms)`; `widget.dom.input` shows
  `input <selector> = "value"`; etc.
- **Result modal: tested-methods + step count + capture time** in a
  subline under the trace title. Missing-step rows render with a red
  "MISSING" badge so step_missing failures are visible in the rail.
- **Debug flag**: set `window.__studioDebug = true` in DevTools to enable
  `[studio]` / `[bridge]` traces. Iframe logs are piped to the parent so
  they appear regardless of console context filter. Off by default.

### Changed
- **Widget iframe lifecycle.** Iframe mounts once per widget URL; mock
  updates flow via `postMessage({type: "studio_set_mock", mock})`. The
  injected mock-openai shim mutates `window.openai.toolOutput / toolInput
  / widgetState` in place and dispatches `openai:set_globals` so the
  widget re-renders without an iframe reload. Eliminates the
  reload-wipes-listeners class of bug.
- **`renderWidget` is action-driven.** Record and replay run the SAME
  code paths through the recorder bus. No more `recorder.suspend()`
  workarounds.
- **Synthetic clicks dispatch the full pointer sequence**
  (`pointerover → mouseover → pointerdown → mousedown → focus →
  pointerup → mouseup → click`), matching what `@testing-library/user-event`
  does. Fixes replays where React/Radix handlers wired to `mousedown` or
  `pointerdown` ignored bare `click` events.
- **Engine `waitFor` matches by `(driver, kind)`** instead of consuming
  the first ambient action. Prevents leftover `widget.dom.click` echoes
  from being mistakenly consumed in place of a `widget.intent`.
- **Bridge selector resolution retries for 500ms** (polls every 16ms)
  to cover post-React-commit timing.
- **`mcp-studio` CHANGELOG, testing-logic, and test-recorder-and-replay
  docs** updated to reflect the new render lifecycle and action set.

### Fixed
- **Kind prefix mismatch** in the iframe bridge: `dispatchSynthetic`
  expected `widget.dom.click` but the engine sent `dom.click`. Every
  click dispatch silently no-op'd (ack returned OK but no event fired).
- **Race between widget render and next dispatch.** Engine now awaits
  the iframe's `render.complete` on the first mount of a new widget
  before the next dispatch can race a half-loaded iframe.
- **`foldTrace` dropped extra step fields** like `compare`. Fixed by
  spreading the source step (`{...s, stateAfter}`) so new fields
  round-trip on every load.
- **`event.isTrusted` spoof** on synthetic mouse/pointer events
  (`Object.defineProperty(e, "isTrusted", {value: true})`) so widget
  libraries that gate on it still run.

### Removed
- **`recorder.suspend()` callers** — all gone. The bus retains the
  primitive but no caller invokes it outside the bus implementation.
- The verbose chain logs (`step1/step2/step3/step5/host RX`) that
  accumulated during debugging - replaced with the `__studioDebug` flag.

## [0.2.0] – 2026-05-12

- **Widget render 2.0** — postMessage-based iframe update protocol;
  stable iframe across mock changes.
- **Tag system** for organizing tests in the catalog.
- **Show rules** popup on each test row.
- **Step-by-step replay** scaffolding.
- **Sensitive-test-case coverage** in the auto-classifier (JWT, AWS
  keys, Stripe keys, high-entropy strings render masked).
- Documentation updates for the widget rendering surface.

## [0.1.9] – 2026-05

- **Trace player** in the result modal (auto-advance, speed control,
  per-step timeline).
- **Replay + run history** persisted in-memory per session.
- **Event-sourcing refactor**: state evolves only through actions on
  the recorder bus. Differ runs over `Step.stateAfter` pairs.
- Auto-track MCP server when offline; disable destructive controls
  while disconnected.
- Fix: OAuth redirect rewrites localhost → public endpoint when
  Studio is reachable through a tunnel.

## [0.1.8] – 2026-04

- **Cue spec v1** — record-and-replay file format spec, JSON envelope
  with `setup`, `fixtures`, `steps`, and (then-future) `tags` / `retry`
  / `teardown` fields.
- **Render widget at replay** — widget HTML loaded into the result
  modal preview alongside the per-step drift cards.
- **Profiles** — switch between named MCP server configurations;
  per-profile auth scope.
- Layout reformat: profile / cloud / auth moved into the sidebar so
  the top bar focuses on test ergonomics.
- Fix: CSP evaluator handles inline `new Function(...)` correctly.
- Fix: OAuth 2.1 callback issue when proxy URL contains a port.

## [0.1.6] – 2026-04

- **Rename to engine**: pull the replay loop out of `player.ts` into a
  `core/engine.ts` module; allow replaying historical test results.
- **Record and replay tests** end-to-end: capture every user
  interaction, replay through drivers, diff state.
- **Run step by step** prototype: pause-and-advance UI for replays.
- **Action union** consolidated under `lib/core/types.ts`.
- **HTML preview** in the widget pane (raw HTML alongside the rendered
  iframe).
- **Confirmation dialog on delete** for saved tests.
- Fix: CSP verifier didn't catch inline event handlers in some cases.

## [0.1.3] – 2026-04

- **Tunnel attach**: studio talks to the proxy through a Cloudflare
  tunnel, so widget assets fetched by URL work end-to-end.
- **Release flow** — versioned builds + bumped lockfiles.
- Minor UI tweaks (text, sidebar address bar).

## [0.1.0] – 2026-04

- Initial MCP Studio: sidebar of tools/resources, editor for tool
  args, request / response inspector, widget preview iframe, sandboxed
  CSP runtime, recorder bus.

[Unreleased]: ../#unreleased
[0.2.0]: ../#020---2026-05-12
[0.1.9]: ../#019---2026-05
[0.1.8]: ../#018---2026-04
[0.1.6]: ../#016---2026-04
[0.1.3]: ../#013---2026-04
[0.1.0]: ../#010---2026-04
