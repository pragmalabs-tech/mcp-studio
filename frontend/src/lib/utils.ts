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
