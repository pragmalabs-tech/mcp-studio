# core/ behaviour contract

The single rule: `state(n) = transition(state(n-1), action(n))`.

## What each module guarantees

| Module               | Guarantees                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`           | Action union, State shape (per-driver slices), Trace, Verdict, Driver interface. No runtime code.                                                                                                                                                                                                                                                                                                         |
| `registry.ts`        | `buildInitialState()` composes per-driver `initialSlice()` + the registry-owned `network` slice; `driverFor(action)` routes by `driver` id (throws on unknown); `allVolatilePaths()` aggregates per-driver paths prefixed with each driver's slice key.                                                                                                                                                   |
| `drivers/studio.ts`  | Owns `state.studio`. Pure `apply` for `select`, `set_args`, `set_config` (shallow merge), `set_mock`. Empty `volatilePaths` (deterministic on replay).                                                                                                                                                                                                                                                    |
| `drivers/mcp.ts`     | Owns `state.tools` + writes to `state.network`. `apply_request` bumps requestCount and (for `tools/call`) the named tool's callCount. `apply_response` bumps responseCount and (when `payload.tool` set) attributes result/error to that tool. Volatile paths cover server-generated ids, timestamps, and the `current_datetime` context.                                                                 |
| `drivers/widget.ts`  | Owns `state.widgets` + writes to `state.network.errorCount`. `apply_opened` pushes onto the open stack and bumps renderCount. `apply_runtime_error` flags top-of-stack and bumps errorCount. All `dom.*` actions return the SAME state reference (pure observations — what they cause shows up as the next Action).                                                                                       |
| `fold.ts`            | `applyAction(state, action)` routes via registry (pure single-step). `fold(initial, actions[])` returns one State per action in order. `foldTrace(trace)` fills `stateAfter` on every step (idempotent).                                                                                                                                                                                                  |
| `differ.ts`          | `diff(recorded, replayed, volatilePaths)` walks each step's `stateAfter` pair, emits one `Drift` per disagreeing leaf (`value_differs`, `type_differs`, `missing`, `extra`), one drift per length-mismatch step (`step_missing` / `step_extra`). Volatile patterns suppress drifts at matching paths only. Drifts sorted by `(stepIndex, path)`. `verdict.ok = true` iff no drift has `severity: "fail"`. |
| `util/path-match.ts` | `matchesAnyPattern(path, patterns)` boolean. `*` matches one object-key segment; `[*]` matches one array-index segment. Pattern length must equal path length.                                                                                                                                                                                                                                            |

## Test layout

Each module has co-located `xxx.test.ts`. Tests verify _contracts_, not
JS-level invariants the type system already enforces. Naming:
`subject__case` (e.g. `apply_select__clears_when_payload_is_null`).

## What's intentionally NOT tested

- Type-only invariants (the compiler enforces them).
- Pure function purity beyond one sanity check per driver.
- Slice-ownership discipline as a separate check (registry tests imply it).
- Cross-driver composition end-to-end (covered by `fold` tests; deeper
  integration is the engine's job in Phase 3).
