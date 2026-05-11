/**
 * Tag normalization helpers. Single source of truth so the save modal,
 * inline edit popover, and any backend echo agree on what a tag list
 * looks like on disk.
 */

export function normalizeTag(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  return t.length === 0 ? null : t;
}

export function normalizeTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = normalizeTag(r);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Union of tags across loaded summaries, sorted alphabetically. */
export function collectTags(tests: readonly { tags?: string[] }[]): string[] {
  const set = new Set<string>();
  for (const t of tests) for (const tag of t.tags ?? []) set.add(tag);
  return [...set].sort();
}
