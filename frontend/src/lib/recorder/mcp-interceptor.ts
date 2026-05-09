import { recorder } from "./bus";
import type { Source } from "./schema";

let nextId = 1;

type FlushFn = () => void;
const flushHooks = new Set<FlushFn>();

/** Register a callback that the interceptor will call before emitting an `mcp.request`. */
export function registerPreRequestFlush(fn: FlushFn): () => void {
  flushHooks.add(fn);
  return () => flushHooks.delete(fn);
}

function flushPending() {
  for (const fn of flushHooks) {
    try {
      fn();
    } catch {
      /* hooks must not break the call path */
    }
  }
}

function serializeError(err: unknown): { message: string } {
  if (err instanceof Error) return { message: err.message };
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

export type RawCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export async function recordedMcpCall(
  raw: RawCall,
  method: string,
  params: Record<string, unknown> = {},
  source: Source = "user",
): Promise<unknown> {
  const recording = recorder.mode === "recording";
  if (recording) flushPending();
  const id = recording ? nextId++ : 0;
  if (recording) {
    recorder.emit({ kind: "mcp.request", id, source, method, params });
  }
  const t0 =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  try {
    const result = await raw(method, params);
    if (recording) {
      const t1 =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      recorder.emit({
        kind: "mcp.response",
        requestId: id,
        result,
        durationMs: t1 - t0,
      });
    }
    return result;
  } catch (err) {
    if (recording) {
      const t1 =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      recorder.emit({
        kind: "mcp.response",
        requestId: id,
        error: serializeError(err),
        durationMs: t1 - t0,
      });
    }
    throw err;
  }
}
