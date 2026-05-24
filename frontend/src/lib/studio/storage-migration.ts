/**
 * One-time migration: rename legacy `mcpr_*` localStorage keys to their
 * `studio*` equivalents. Must run before any other module reads
 * localStorage on app startup. Idempotent (gated on a done flag).
 *
 *   mcpr_studio:{origin}:{suffix}   ->  studio:{origin}:{suffix}
 *   mcpr_oauth_{origin}_{suffix}    ->  studio_oauth_{origin}_{suffix}
 *
 * Safe to drop after one release cycle once all active users have run
 * it; keeping it costs ~one localStorage read per app start.
 */

import { putReplay, putTest } from "@/lib/studio/storage-api";
import type { SavedTest } from "@/lib/tests/storage";
import type { SavedReplay } from "@/lib/replays/storage";
import { slugify } from "@/lib/tests/format";

const DONE_FLAG = "studio:storage_migration_v1";

const RENAMES: Array<readonly [string, string]> = [
  ["mcpr_studio:", "studio:"],
  ["mcpr_oauth_", "studio_oauth_"],
];

export function migrateLegacyKeys(): void {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(DONE_FLAG)) return;

  const snapshot: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k !== null) snapshot.push(k);
  }

  for (const oldKey of snapshot) {
    for (const [oldPrefix, newPrefix] of RENAMES) {
      if (oldKey.startsWith(oldPrefix)) {
        const newKey = newPrefix + oldKey.slice(oldPrefix.length);
        const value = localStorage.getItem(oldKey);
        if (value !== null && localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, value);
        }
        localStorage.removeItem(oldKey);
        break;
      }
    }
  }

  localStorage.setItem(DONE_FLAG, "1");
}

/**
 * One-time lift from the legacy localStorage-backed tests/replays into
 * the studio backend's file store. Fired from `store.loadAll`.
 *
 * Idempotent: each key is removed only after every entry under it
 * successfully PUTs to the backend. A partial-success run keeps the
 * legacy key intact so the next boot retries the failures.
 *
 * Failures per entry log but don't throw — a malformed leftover or a
 * one-off network blip shouldn't strand the migration. Errors surface
 * as console warnings only.
 */
const LEGACY_TESTS_KEY = "mcp-studio-tests";
const LEGACY_REPLAYS_KEY = "mcp-studio-replays";

export async function migrateLocalStorageToBackend(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  await migrateTestsFromLocalStorage();
  await migrateReplaysFromLocalStorage();
}

async function migrateTestsFromLocalStorage(): Promise<void> {
  const raw = localStorage.getItem(LEGACY_TESTS_KEY);
  if (!raw) return;
  let parsed: SavedTest[];
  try {
    parsed = JSON.parse(raw) as SavedTest[];
  } catch {
    // Garbled — drop it; nothing to migrate.
    localStorage.removeItem(LEGACY_TESTS_KEY);
    return;
  }
  let anyFailed = false;
  for (const test of parsed) {
    try {
      const slug = slugify(test.name);
      await putTest(slug, { ...test, id: slug });
    } catch (e) {
      console.warn("migrateLocalStorage: test failed", test.id ?? test.name, e);
      anyFailed = true;
    }
  }
  if (!anyFailed) localStorage.removeItem(LEGACY_TESTS_KEY);
}

async function migrateReplaysFromLocalStorage(): Promise<void> {
  const raw = localStorage.getItem(LEGACY_REPLAYS_KEY);
  if (!raw) return;
  let parsed: SavedReplay[];
  try {
    parsed = JSON.parse(raw) as SavedReplay[];
  } catch {
    localStorage.removeItem(LEGACY_REPLAYS_KEY);
    return;
  }
  let anyFailed = false;
  for (const replay of parsed) {
    try {
      await putReplay(replay.id, replay);
    } catch (e) {
      console.warn("migrateLocalStorage: replay failed", replay.id, e);
      anyFailed = true;
    }
  }
  if (!anyFailed) localStorage.removeItem(LEGACY_REPLAYS_KEY);
}
