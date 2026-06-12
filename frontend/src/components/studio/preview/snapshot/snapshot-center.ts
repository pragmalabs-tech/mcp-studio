import { serializeIframeDocument, type WidgetSnapshot } from "./snapshot";
export type { WidgetSnapshot };

export type WidgetId = string;

export function getWidgetIframe(widgetId: WidgetId): HTMLIFrameElement | null {
  return document.getElementById(
    `widget-iframe-${widgetId}`,
  ) as HTMLIFrameElement | null;
}

/** Synchronous snapshot of a widget's current iframe state. */
export function captureWidgetSnapshot(
  widgetId: WidgetId,
): WidgetSnapshot | null {
  const iframe = getWidgetIframe(widgetId);
  return iframe ? (serializeIframeDocument(widgetId, iframe) ?? null) : null;
}

type SnapshotEntry = {
  result: WidgetSnapshot | null;
  captured: boolean;
  onCapture?: (snap: WidgetSnapshot | null) => void;
};

/**
 * Manages async snapshot capture for widget renders (ToolCallAction path only).
 * Click/canvas/text actions use `captureWidgetSnapshot` directly.
 */
class SnapshotCenter {
  private _entries = new Map<WidgetId, SnapshotEntry>();
  private _timers = new Map<WidgetId, number>();
  private _waiters = new Map<
    WidgetId,
    Array<(snap: WidgetSnapshot | null) => void>
  >();

  /**
   * Schedule a snapshot after `timeoutMs`. Re-registration cancels the old
   * timer (on re-render of the same widget) without resolving waiters — they
   * carry over to the new capture.
   */
  register(
    widgetId: WidgetId,
    timeoutMs: number,
    onCapture?: (snap: WidgetSnapshot | null) => void,
  ): void {
    const existing = this._timers.get(widgetId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this._timers.delete(widgetId);
    }
    this._entries.set(widgetId, { result: null, captured: false, onCapture });
    const timer = setTimeout(
      () => this._capture(widgetId),
      timeoutMs,
    ) as unknown as number;
    this._timers.set(widgetId, timer);
  }

  /**
   * Async wait for the render snapshot. Safe to call before `register` — the
   * waiter is parked and resolved when capture fires. Times out after
   * `maxWaitMs` and force-captures at that point.
   */
  waitFor(
    widgetId: WidgetId,
    maxWaitMs: number,
  ): Promise<WidgetSnapshot | null> {
    const entry = this._entries.get(widgetId);
    if (entry?.captured) return Promise.resolve(entry.result);

    return new Promise<WidgetSnapshot | null>((resolve) => {
      const list = this._waiters.get(widgetId) ?? [];
      list.push(resolve);
      this._waiters.set(widgetId, list);

      setTimeout(() => {
        const e = this._entries.get(widgetId);
        if (e && !e.captured) this._capture(widgetId);
        else if (!e) this._resolveWaiters(widgetId, null);
      }, maxWaitMs) as unknown as number;
    });
  }

  /**
   * Cancel the pending timer and remove the entry. Does NOT resolve waiters —
   * they stay parked for the next `register` call (re-render of same widget)
   * or resolve via `waitFor`'s own timeout.
   */
  unregister(widgetId: WidgetId): void {
    const timer = this._timers.get(widgetId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._timers.delete(widgetId);
    }
    this._entries.delete(widgetId);
  }

  private _capture(widgetId: WidgetId): void {
    const entry = this._entries.get(widgetId);
    if (!entry || entry.captured) return;
    const snapshot = captureWidgetSnapshot(widgetId);
    entry.captured = true;
    entry.result = snapshot;
    entry.onCapture?.(snapshot);
    this._resolveWaiters(widgetId, snapshot);
  }

  private _resolveWaiters(
    widgetId: WidgetId,
    snap: WidgetSnapshot | null,
  ): void {
    const waiters = this._waiters.get(widgetId);
    if (waiters) {
      for (const resolve of waiters) resolve(snap);
      this._waiters.delete(widgetId);
    }
  }
}

export const snapshotCenter = new SnapshotCenter();
