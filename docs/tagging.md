# MCP Studio — Tagging

Tags are short, free-form labels attached to a `SavedTest`. They serve two purposes: **organisation** (grouping related tests by feature, owner, or status) and **filtering** (narrowing the test catalog to a relevant subset).

---

## 1. Data Model

Tags are stored on `SavedTest` as a normalised string array:

```typescript
interface SavedTest {
  // ... existing fields ...
  tags?: string[];   // sorted, lowercased, deduped; absent == []
}
```

A tag is a non-empty lowercase string. The canonical form is produced by `normalizeTag` / `normalizeTags` in `frontend/src/lib/tests/tags.ts` — that module is the single source of truth for normalisation and must be used everywhere a tag list is written (save modal, inline edit).

### Constraints

| Property | Rule |
|----------|------|
| Case | Lowercase only. Input is coerced, not rejected. |
| Whitespace | Leading/trailing whitespace stripped. |
| Duplicates | Silently deduplicated after normalisation. |
| Empty string | Dropped silently. |
| Max length | 64 characters per tag (UI enforced, not a hard backend limit). |
| Max count | No hard limit; UI warns at > 20 tags per test. |

---

## 2. Managing Tags

### Adding tags

Tags are added in two places:

- **Save modal** (when creating a new test from a recording): includes a tag input field. The user types a tag and presses `Enter` or `,` to confirm it; a chip appears inline. Tags are normalised before the `SavedTest` is written.
- **Test detail panel** (editing an existing test): an inline tag editor shows current chips and accepts new input the same way. Changes are written via `updateTestTags(id, tags)`, which patches only the `tags` field — analogous to `updateTestAssertions`.

### Removing tags

Each tag chip has an `×` button. Clicking it removes the tag immediately and persists the updated list.

### Persistence

Tag writes follow the same pattern as assertion updates — fetch the full `SavedTest`, splice the `tags` field, and PUT it back:

```typescript
export async function updateTestTags(
  id: string,
  tags: string[],
): Promise<void> {
  const existing = await apiGetTest(id);
  if (!existing) return;
  await putTest(id, { ...existing, tags: normalizeTags(tags) });
}
```

No schema migration is needed: `tags` is optional and defaults to `[]` for tests that pre-date the feature.

---

## 3. Filtering by Tag

### Catalog filter bar

The test catalog lists all known tags (via `collectTags`) as clickable pills. Selecting one or more pills narrows the displayed tests to those carrying **all** selected tags (AND semantics). Selecting zero pills shows all tests.

```typescript
function matchesTags(test: SavedTest, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const testTags = new Set(test.tags ?? []);
  return selected.every((t) => testTags.has(t));
}
```

### URL state

Selected tags are reflected in the URL query string (`?tags=auth,smoke`) so filters survive navigation and can be bookmarked or shared.

### Run / replay scope (future)

The run modal will support a **tag filter** field that restricts a bulk replay to tests matching the selected tags. The filter is evaluated client-side against the loaded catalog before the replay queue is built — no backend change required.

---

## 4. Tag Conventions (recommended, not enforced)

| Convention | Example tags |
|------------|-------------|
| Feature area | `auth`, `search`, `checkout` |
| Status / lifecycle | `smoke`, `regression`, `wip`, `flaky` |
| Owner | `team-platform`, `team-growth` |
| Environment | `prod-only`, `staging-only` |

Studio does not validate or suggest tags — these are conventions teams adopt for themselves.

---

## 5. File Map

| Path | Role |
|------|------|
| `frontend/src/lib/tests/tags.ts` | Normalisation helpers (`normalizeTag`, `normalizeTags`, `collectTags`) |
| `frontend/src/lib/tests/storage.ts` | `SavedTest` interface; add `updateTestTags` here alongside `updateTestAssertions` |
| `frontend/src/components/TagInput.tsx` | Chip input component (shared between save modal and detail panel) |
| `frontend/src/components/TagFilter.tsx` | Pill bar in the catalog header |
