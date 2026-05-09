import type { Session, Test } from "@/lib/recorder/schema";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // RFC 4122 v4-ish fallback for environments without randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function newTest(input: {
  name: string;
  description?: string;
  session: Session;
}): Test {
  return {
    id: uuid(),
    name: input.name,
    description: input.description,
    createdAt: new Date().toISOString(),
    session: input.session,
  };
}

/**
 * Mirror of the backend `safe_filename` slug rules so the UI can preview the
 * filename a user's name will produce. Keep in sync with `mcp-studio/src/storage.rs`.
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
