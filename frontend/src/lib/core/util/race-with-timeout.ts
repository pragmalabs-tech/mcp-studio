/**
 * Race a promise against a wall-clock timer. Resolves with the promise's
 * value if it settles first, or with `fallback` after `ms` elapses. The
 * underlying promise is not cancelled — it just no longer affects the
 * returned value.
 */
export function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}
