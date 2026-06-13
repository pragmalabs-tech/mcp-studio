import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Poll `pred` every `stepMs` until it returns true or `capMs` elapses. */
export async function waitUntil(
  pred: () => boolean,
  capMs: number,
  stepMs = 25,
): Promise<void> {
  const deadline = Date.now() + capMs;
  while (!pred() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** Monotonic timestamp in ms — prefers `performance.now()`, falls back to `Date.now()`. */
export function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/** Wall-clock timestamp string: `HH:MM:SS.mmm` */
export function formatTimestamp(): string {
  const now = new Date();
  return (
    now.toTimeString().split(" ")[0] +
    "." +
    String(now.getMilliseconds()).padStart(3, "0")
  );
}

/** Cryptographically random URL-safe string of the requested length. */
export function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
