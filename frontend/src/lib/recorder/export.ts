import type { Session } from "./schema";

export function toJsonBlob(session: Session): Blob {
  return new Blob([JSON.stringify(session, null, 2)], {
    type: "application/json",
  });
}

export function downloadSession(session: Session, filename?: string): void {
  const blob = toJsonBlob(session);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `mcp-studio-session-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
