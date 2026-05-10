/**
 * Slug rules shared with the backend so the UI can preview the filename
 * a user's chosen name will produce. Keep in sync with
 * `mcp-studio/src/storage.rs:safe_filename`.
 */
export function slugify(input: string): string {
  let out = "";
  let prevDash = false;
  for (const ch of input) {
    const c = ch.toLowerCase();
    if (/[a-z0-9]/.test(c)) {
      out += c;
      prevDash = false;
    } else if (c === "-" || c === "_") {
      if (!prevDash && out.length) {
        out += c;
        prevDash = true;
      }
    } else if (/\s/.test(c)) {
      if (!prevDash && out.length) {
        out += "-";
        prevDash = true;
      }
    }
  }
  while (out.endsWith("-") || out.endsWith("_")) out = out.slice(0, -1);
  if (!out) out = "untitled";
  if (out.length > 64) {
    out = out.slice(0, 64);
    while (out.endsWith("-") || out.endsWith("_")) out = out.slice(0, -1);
  }
  return out;
}
