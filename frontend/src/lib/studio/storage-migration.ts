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
