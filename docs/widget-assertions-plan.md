# Widget assertions for mcp-studio — research-driven design

> Status: parked. Decided 2026-05-18. We approved the design but chose to ship smaller improvements to the current system first. Pick this up when we're ready to invest 1-2 weeks on the new assertion vocabulary.

## Context

The current test model compares recorded `stateAfter` against replayed `stateAfter` byte-for-byte. Research across Playwright docs, Testing Library, Storybook 8, snapshot-testing postmortems (Sapegin, Dor Shinar, Soluto), and the MCP Apps spec converges decisively against that model: **byte-equality DOM/payload assertions don't fail gracefully — they fail with trust collapse.** No team has published the opposite postmortem.

What the same sources DO recommend, in a clear order of robustness:

1. **Contract assertions** — observable things the widget *did* (intent emitted, tool called with shape Y)
2. **Semantic DOM assertions** — what the user is supposed to *see* (role/text/label queries, auto-retried)
3. **ARIA snapshot assertions** — overall structural shape, partial-match by default (Playwright's 2024 `toMatchAriaSnapshot`)
4. **Smoke checks** — separate, narrower category: didn't blow up (uncaught error, blank render, render time, CSP block)

The MCP iframe sandbox is a *feature* for testability — every UI↔host message is JSON-RPC over postMessage, so the contract surface is already auditable without DOM coupling. The studio already captures it (`widgets.intents[]`, `mock-claude.ts:83-300`); we just don't expose it as an assertion primitive.

Goal: make the studio's default assertion vocabulary match the consensus hierarchy. Demote byte-diff to an escape hatch; promote contract + semantic-DOM + ARIA + smoke to first-class rule kinds with discoverable authoring UX.

## Assertion vocabulary

Four kinds, each answering a different question. The author picks the kind that matches the question they're trying to ask. The studio's UI nudges them toward the most-robust kind that fits.

### 1. Contract assertions (most robust — start here)

**Question they answer:** "Did the widget *do* the right thing the host can observe?"
**When to use:** Anytime there's an observable side effect — intent emitted, tool called, network call, state slice updated. This is the strongest assertion you can write because it's framework-agnostic and survives any rendering refactor.
**Why robust:** Asserts on the externally observable contract, not on how the widget is implemented. The MCP postMessage protocol IS the contract.

```ts
| { kind: "intent_emitted"; name: string; paramsMatch?: Record<string, Matcher> }
| { kind: "tool_called"; name: string; argumentsMatch?: Record<string, Matcher> }
| { kind: "state_path_equals"; path: string; matcher: Matcher }   // for fields where exact-match IS the contract
```

`paramsMatch` / `argumentsMatch` reuse the existing `Matcher` from `types.ts:245-250` (`@uuid`, `@iso8601`, `@epoch`, `@any`, `{ regex }`), so author muscle-memory carries over from the existing rules system.

### 2. Semantic DOM assertions (default for "the user sees X")

**Question they answer:** "Is the user-meaningful element actually there?"
**When to use:** When the test should fail if a button, form field, headline, or list item the user needs is missing or invisible. Cheap to write, immune to class/id churn.
**Why robust:** Matches how a human describes "the widget is working." Doubles as a11y coverage. Survives any styling refactor.

```ts
| { kind: "by_role"; role: string; name?: string; timeoutMs?: number }
| { kind: "by_text"; text: string; caseSensitive?: boolean; timeoutMs?: number }
| { kind: "by_label"; label: string; timeoutMs?: number }
| { kind: "visible"; selector: string; timeoutMs?: number }       // escape hatch
```

Order of UI suggestion: `by_role` → `by_text` → `by_label` → `visible`. `visible` is offered last with a tooltip warning ("selector queries break on refactors — prefer role/text"). This mirrors Testing Library's official query priority.

### 3. ARIA snapshot (structural shape without freezing content)

**Question they answer:** "Did the widget render the right *shape* of UI?"
**When to use:** When you want to assert "the question widget has a heading, a list of N choices, a submit button" without caring about the choice text (which is data-driven). Catches "widget collapsed" or "section disappeared" without catching every data change.
**Why robust:** Captures structure; ignores dynamic text/IDs by default. Partial match means user can omit attributes/names they don't care about.

```ts
| { kind: "aria_snapshot"; snapshot: string }   // YAML format, partial-match by default
```

Stored as YAML on the trace (Playwright's format):
```yaml
- heading "Question"
- list:
  - listitem
  - listitem
  - listitem
- button "Submit"
```

The runner walks the iframe's accessibility tree, serializes to the same YAML shape, and compares. Matches are partial (extra DOM is fine), names support regex (`/Question \d+/`).

### 4. Smoke checks (separate category — cheap "obviously broken" guards)

**Question they answer:** "Did the widget blow up?"
**When to use:** Always-on baseline. Catches regressions where the widget threw, never rendered, or crossed a CSP wall — failures so basic that no specific assertion would have been written for them.
**Why distinct from Contract:** A `console.error` from a third-party library is not a contract violation; `hasRuntimeErrors === true` (the widget threw uncaught) IS. Conflating them produces false positives. Smoke is opt-in, narrow, and never asserts on console *content*.

```ts
| { kind: "no_uncaught_errors" }         // window.onerror / unhandledrejection fired
| { kind: "no_csp_violations" }          // CSP captured any violation
| { kind: "rendered_within"; ms: number }
| { kind: "rendered_non_empty"; minBodyChars?: number }  // catches blank-render
```

Importantly **NOT** offered: `no_console_errors`. The research is clear that this is noise — widgets log deprecation warnings, fetch failures they handle, debug spam. Asserting on it turns honest dependencies into red builds.

## TraceRules shape

```ts
export interface TraceRules {
  ignore?: string[];
  match?: Record<string, Matcher>;
  /** Per-step widget assertions. Key is the original-trace step index
   *  (as a string) or "*" to apply to every widget render step. */
  widget?: Record<string, WidgetAssertion[]>;
}

export type WidgetAssertion =
  | ContractAssertion
  | SemanticDomAssertion
  | AriaSnapshotAssertion
  | SmokeAssertion;
```

Single field on `TraceRules.widget`. The four union variants share a `kind` discriminator so the runner can dispatch with a switch.

## The runner

A new `frontend/src/lib/core/widget-assert.ts` exports:

```ts
export interface AssertionContext {
  iframe: HTMLIFrameElement | null;   // null in replay mode
  state: State;                        // the step's stateAfter (for contract checks)
  consoleEntries: ConsoleEntry[];      // counts/uncaught only — never matched against content
  cspViolations: CspViolation[];
  renderReport: RenderReport | undefined;
}

export async function runWidgetAssertions(
  assertions: WidgetAssertion[],
  ctx: AssertionContext,
): Promise<AssertionResult[]>;
```

**Live vs replay execution.** Two modes:

- **Live mode** (interactive testing): `iframe` non-null. Semantic DOM + ARIA snapshot assertions query the iframe's `contentDocument` directly. Contract + smoke read from state + capture buffers.
- **Replay mode** (saved run-result re-evaluated): no iframe. Semantic DOM / ARIA snapshot assertions degrade to `skipped` with an explanatory drift (`reason: "assertion_skipped"`). Contract + smoke still run because they're sourced from state, which the replay reconstructs.

Results map into the existing `Drift` type with new `DriftReason = "assertion_failed" | "assertion_skipped"`, so they surface in the existing drift-card UI the user already knows.

## State telemetry (prerequisite)

Most signals already stream from the widget — they just don't land in state for the differ/runner to see. Add a `RenderReport` to each `OpenWidget`:

```ts
export interface OpenWidget {
  uri: string;
  data: unknown;
  mounted: boolean;
  hasErrors: boolean;
  render?: RenderReport;       // NEW
}

export interface RenderReport {
  durationMs: number;
  bodyChars: number;
  uncaughtErrors: number;      // count of window.onerror + unhandledrejection
  cspViolations: number;
  handshakeOk: boolean;
}
```

Composed in `widget.ts` driver when the `render.complete` event lands (already emitted by `mock-claude.ts:93-108`). Counts only — never content — because content is environment-noisy and re-introduces the false-positive problem we're solving.

## Authoring UX

Three surfaces, each makes the right thing the easy thing:

1. **One-click smoke pack.** Button at top of rules editor: "Enable smoke checks." Adds `no_uncaught_errors`, `no_csp_violations`, `rendered_within: 5000`, `rendered_non_empty` to every widget render step. This is the always-on baseline — gets the user from zero to a meaningful test in one click.

2. **"Convert drift to assertion" picker.** When a drift surfaces on a widget-render path in the run-result viewer, the drift-card "match as..." picker (`drift-card.tsx:144-218`) offers a third option group: "convert to assertion." For drifts on `widgets.intents[*]`, suggests `intent_emitted`. For drifts on `tools.*.callCount`, suggests `tool_called`. Auto-fills from drift context.

3. **Inspector "Add assertion" affordance.** In the step inspector we just shipped, when the user views a `widget.render` step, the right pane gets an "Add assertion" button. Opens a small wizard:
   - **Q1: "What do you want to assert?"** Options ordered by robustness:
     - "Something happened" → Contract (intent / tool call)
     - "The user sees X" → Semantic DOM (role / text / label)
     - "The shape is right" → ARIA snapshot
     - "Just don't crash" → Smoke
   - **Q2 (per choice):** specific fields. For `by_role`: dropdown of roles found in the iframe; for `intent_emitted`: dropdown of intent names actually emitted in this trace.
   - The dropdowns being live-populated from the recording is the key UX move — the user picks from what they already know exists, not from a docs page.

## When to reach for which (decision tree the UI nudges users toward)

| Question | Reach for |
|---|---|
| Did the widget *send* the right thing back? | **Contract** (`intent_emitted`, `tool_called`) |
| Should a specific button / heading / list item be visible? | **Semantic DOM** (`by_role`, `by_text`) |
| Is the overall structural shape (sections, count of items) correct? | **ARIA snapshot** |
| Just don't want it to silently break? | **Smoke** (enable the one-click pack) |
| The exact JSON of a field really must match (e.g. a known constant)? | The existing `state_path_equals` matcher chain (`match` rule + `@regex`) — escape hatch, used sparingly |
| The pixel output must match? | Out of scope. Use a separate visual-regression tool. |

Default behavior: **smoke pack on, contract + semantic-DOM authored per-step as needed, ARIA snapshot for stable layouts.** Payload byte-diff is no longer the default contract.

## Files to modify / create

| File | Change |
|---|---|
| `frontend/src/lib/core/types.ts` | Add `RenderReport`, extend `OpenWidget`, add `WidgetAssertion` union + `widget` field on `TraceRules`, add `"assertion_failed"` / `"assertion_skipped"` to `DriftReason`. |
| `frontend/src/lib/core/drivers/widget.ts` | Handle a new `widget.render_complete` action; compose `RenderReport` and stamp it on `OpenWidget`. |
| `frontend/src/lib/studio/mock-claude.ts` | Where it currently emits `widget.render.complete` to the recorder bus (lines 93-108), also emit the corresponding action so the report lands in state. |
| `frontend/src/lib/studio/mock-openai.ts` | Same wiring on the OpenAI side. |
| `frontend/src/lib/core/widget-assert.ts` | **NEW** — runner for `WidgetAssertion[]`. Dispatch on `kind`. ~250 LOC. |
| `frontend/src/lib/core/aria-snapshot.ts` | **NEW** — serialize iframe document to Playwright-compatible YAML; partial-match comparator. ~150 LOC. |
| `frontend/src/lib/core/widget-assert.test.ts` | **NEW** — unit tests covering each `WidgetAssertion` kind in both live and replay contexts. |
| `frontend/src/lib/core/differ.ts` | After payload walk, run widget assertions per step via the new runner; fold results into `Verdict.drifts` with the new reasons. Pass `_iframeRef` from store in live mode, `null` in replay. |
| `frontend/src/lib/core/rules.ts` | Resolve `widget` rules (trace-level only — no built-in layering needed initially). |
| `frontend/src/components/studio/rules-editor.tsx` | "Enable smoke checks" button; per-step assertion editor for `widget` rule kind. |
| `frontend/src/components/studio/drift-card.tsx` | Add "convert to assertion" picker for widget-pathed drifts. |
| `frontend/src/components/studio/step-inspector-detail.tsx` | "Add assertion" button + wizard for the selected step. Live-populate dropdowns from the recorded trace. |
| `frontend/src/lib/core/views/step-detail.tsx` | "Render checks" section in the trace-modal that shows per-step assertion results (re-uses `DriftCard` tier system). |

No backend changes. No new runtime deps (ARIA serializer can be hand-rolled — the Playwright YAML format is documented and simple enough; pulling Playwright would be massive overkill).

## Phases (ship each independently)

1. **Phase 1 — RenderReport plumbing.** State surface only; no new rule kind yet. Existing `match`/`ignore` immediately become more powerful (user can `ignore widgets.open[*].render.durationMs`). ~1-2 days. Smallest blast radius.
2. **Phase 2 — Smoke + Contract assertions.** New `widget` rule kind. Smoke pack + `intent_emitted` + `tool_called`. These work in BOTH live and replay (no iframe needed). The one-click smoke pack gives immediate user-visible value.
3. **Phase 3 — Semantic DOM assertions.** Live-mode only (iframe required). `by_role`, `by_text`, `by_label`, `visible`. Replay mode degrades to `skipped`.
4. **Phase 4 — ARIA snapshot.** `aria_snapshot` kind. YAML serializer + partial-match comparator. Live-mode only initially.
5. **Phase 5 — Authoring UX.** "Convert drift to assertion" picker on drift-card. "Add assertion" wizard in the inspector. The polish that turns this from "experts edit JSON" to "anyone clicks a button."

Each phase ships behind no flag — additive — and the next builds on the previous. Stop after any phase if scope tightens.

## Verification

After each phase, the same shape:

1. **Phase 1.** Open `test-matching-question` recording, run replay. Confirm `widgets.open[0].render` lands in `stateAfter` with non-zero `durationMs` and `bodyChars`. Add `match: { "widgets.open[*].render.durationMs": "@any" }` — confirm it suppresses the timing drift while still catching a `uncaughtErrors: 0 → N` regression.
2. **Phase 2.** Click "Enable smoke checks" on a fresh recording. Confirm the four smoke checks land in `rules.widget`. Replay → passes. Throw in the widget HTML → replay fails on `no_uncaught_errors` with a clear drift card. Add `intent_emitted: "ui/message"` — confirm it passes when the recording shows that intent and fails when removed.
3. **Phase 3.** Author `by_role: "button", name: "Submit"`. Run live → passes (the button exists). Open the saved run-result → assertion shows as `skipped` with explanation. Remove the button from the widget → live run fails with `assertion_failed`.
4. **Phase 4.** Capture an `aria_snapshot` of the matching-question widget. Confirm partial-match: changing question text doesn't break the assertion; removing the submit button does.
5. **Phase 5.** From the drift card on a `widgets.intents[0].name` drift, click "convert to assertion → intent_emitted." Confirm it pre-fills the name from the drift's actual value and lands in `rules.widget`. From the inspector wizard, author a `by_role` by picking from the live dropdown.

Cross-phase: `pnpm tsc --noEmit`, `pnpm test` clean. New tests in `widget-assert.test.ts` and `aria-snapshot.test.ts` cover every kind in both modes.

## Out of scope (deliberately)

- **Pixel screenshot diff.** Chromatic-style visual regression is its own tool category. The research is unanimous: font-hinting / AA / OS / GPU noise + tuning fatigue. Use a dedicated tool if you need it; we won't ship a half-version.
- **DOM tree snapshot.** Same failure mode as Jest snapshots — sprawl, blind-approve, no encoded intent. The ARIA snapshot subsumes the useful 80% without the failure mode.
- **`no_console_errors` assertion.** Explicitly omitted. Research consensus: widgets log legitimately, asserting "zero errors" turns honest dependencies into red builds. The `uncaughtErrors` count is the meaningful signal.
- **Retry-until-pass semantics beyond `timeoutMs` on DOM queries.** Cypress-style chained-retry is the future enhancement if users need it. v1 ships with single-shot + optional per-assertion timeout.
- **a11y / axe-core checks as a `WidgetAssertion` kind.** Easy to layer later; not in v1 because it's tangential to the assertion-style debate.
- **Snapshot DOM into the trace for replay-mode DOM assertions.** Research says this would be a net negative (sprawl, blind-approve). The honest "skipped" degradation in replay is the right answer.
