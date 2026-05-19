# Changelog

All notable changes to mcp-studio. Format roughly follows Keep a Changelog;
versions correspond to release tags in git.

## [0.2.2] – 2026-05-18

### Added
- **Resources slice in state (`state.resources[uri]`).** `resources/read`
  requests now project the result into a stable shape: `contentCount`,
  `mimeType`, `hasHtml`, and (when the resource is a widget) the
  `openai/widgetCSP` connect/resource/frame domain lists plus
  `openai/widgetDomain`. The raw HTML body is intentionally excluded -
  it drifts on every whitespace change and isn't a meaningful assertion
  target; the metadata is what the host actually contracts on.
- **Warning step severity (`DriftSeverity = "fail" | "warn"`).** Drifts
  can now degrade to warn instead of failing the verdict. Wired up for
  `step_missing` placeholders so a missing widget/server action shows
  inline as a yellow card rather than collapsing the whole replay.
- **Synthetic placeholder steps.** When the engine's `waitForKind` times
  out, it inserts a `Step { synthetic: true }` carrying the recorded
  action's label and the prior `stateAfter`. Keeps `replayed.steps.length`
  aligned with `recorded.steps.length` so the trace modal renders the
  missing step inline; the differ recognises the placeholder and emits a
  single warn `step_missing` instead of comparing empty state against
  recorded state.
- **Step inspector and test inspector panes.** New side panels
  (`step-inspector-detail.tsx`, `test-inspector.tsx`) for drilling into a
  single step's action / state-delta / drift list without leaving the
  catalog view.
- **State-changes view (`state-changes.ts`).** Computes the leaf-level
  delta between consecutive `stateAfter`s and renders it as a compact
  added/removed/changed list - the "what this step actually mutated"
  view that previously required diffing two JSON blobs by eye.
- **Sidebar groups tools by category (`tool-category.ts`).** Tools are
  bucketed by hint (read / write / destructive / etc.) so the sidebar
  shows them organized rather than as one flat list.
- **`docs/actions-and-assertions.md`** - single reference for every
  recordable action, per-slice state effects, volatile/match paths, and
  per-step compare modes. Replaces the older split docs.
- **`docs/widget-assertions-plan.md`** - parked design doc for the next
  generation of widget assertions (contract / semantic-DOM / ARIA /
  smoke). Captured now so the research doesn't have to be redone when we
  pick the work up.
- **`strip-undefined` utility.** Drops `undefined` leaves before JSON
  serialization so traces don't accumulate noise keys that round-trip as
  drift candidates.
- **Replay-gating tests for the studio store** - regression coverage for
  the "don't dispatch into a half-loaded iframe" path.

### Changed
- **`resources/read` is a first-class action target.** The mcp driver
  bumps `state.resources[uri].readCount` on every read and projects the
  response into `state.resources[uri].lastResult`. Tests that read
  widget HTML now have a stable contract to assert on (URI + MIME + CSP
  + widget domain), independent of HTML byte content.
- **Engine emits synthetic step on `waitForKind` timeout** instead of
  bailing out of the replay loop, so the trace modal still renders the
  missing slot inline rather than as a trailing MISSING card.
- **Removed `docs/core-contract.md`, `docs/cue-spec.md`,
  `docs/system-design.md`, `docs/test-recorder-and-replay.md`, and
  `docs/testing-logic.md`** - consolidated into
  `actions-and-assertions.md`. The split docs had drifted out of sync
  with `types.ts`; one source of truth is easier to keep honest.

## [0.2.1] – 2026-05-17

- **Resizable middle/right preview split** at the workspace level. The
  divider between the tool panel and the widget preview is now a 1px
  drag handle; the ratio persists in `localStorage` and is clamped so
  neither column drops below its minimum (360px / 480px). Fixes the
  cramped layout at 1280px desktop widths.
- **Viewport readout in the widget tab row.** Dimensions, current
  rendering scale (`430 × 932 (55%)`), and a `strict CSP` indicator now
  sit next to Copy HTML / Reload, replacing the bottom footer strip so
  the viewport itself gets the full vertical space.
- **Widget viewport frame tightened.** Removed the duplicated
  platform/theme/locale footer (already shown in the config bar),
  reduced internal padding from `p-4` to `p-2`, and centered the
  scaled viewport in both axes. At 1280px the mobile preset renders
  ~60px taller before scale-to-fit kicks in.
- **rAF-throttled ResizeObserver** on the viewport frame. Drag events
  coalesce to one scale update per frame instead of firing
  synchronously on every observer tick, removing the jittery re-scale
  that felt like animation while resizing the split.

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
[0.2.2]: ../#022---2026-05-18
[0.2.1]: ../#021---2026-05-17
[0.2.0]: ../#020---2026-05-12
[0.1.9]: ../#019---2026-05
[0.1.8]: ../#018---2026-04
[0.1.6]: ../#016---2026-04
[0.1.3]: ../#013---2026-04
[0.1.0]: ../#010---2026-04
