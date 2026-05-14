import type { WidgetDomAction } from "@/lib/recorder/schema";
import { isBridgeMessage } from "@/lib/recorder/bridge-protocol";

export interface AckResult {
  ok: boolean;
  mutated?: boolean;
  reason?: string;
}

export interface SnapshotResult {
  html: string;
  errors: string[];
}

export interface RenderCompleteResult {
  bodyChars: number;
  hasRuntimeErrors: boolean;
  handshakeOk: boolean;
  renderDurationMs: number;
}

export interface BridgeClient {
  dispatch(action: WidgetDomAction, timeoutMs: number): Promise<AckResult>;
  ping(timeoutMs: number): Promise<boolean>;
  snapshot(timeoutMs: number): Promise<SnapshotResult>;
  awaitRenderComplete(timeoutMs: number): Promise<RenderCompleteResult>;
  destroy(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  kind: "ack" | "snapshot.result";
}

/**
 * Host-side dispatcher for the recorder bridge inbound channel.
 * Speaks the BridgeMessage protocol; resolves promises on matching `id` for
 * dispatch/ping/snapshot, and on the next `render.complete` event from the
 * iframe for `awaitRenderComplete`.
 */
export function createBridgeClient(
  getIframe: () => HTMLIFrameElement | null,
): BridgeClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let renderResolve: ((r: RenderCompleteResult) => void) | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  /** Most recent render.complete observed, used so a late `awaitRenderComplete`
   *  can resolve immediately if the render already happened. */
  let lastRender: { result: RenderCompleteResult; at: number } | null = null;
  const RENDER_TTL_MS = 3_000;

  function listener(event: MessageEvent) {
    const iframe = getIframe();
    if (!iframe || event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!isBridgeMessage(msg)) return;
    if (!("op" in msg)) return; // capture events handled elsewhere

    if (msg.op === "ack") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve({
        ok: msg.ok,
        mutated: msg.mutated,
        reason: msg.reason,
      } as AckResult);
      return;
    }

    if (msg.op === "snapshot.result") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      p.resolve({ html: msg.html, errors: msg.errors } as SnapshotResult);
      return;
    }

    if (msg.op === "render.complete") {
      const result: RenderCompleteResult = {
        bodyChars: msg.bodyChars,
        hasRuntimeErrors: msg.hasRuntimeErrors,
        handshakeOk: msg.handshakeOk,
        renderDurationMs: msg.renderDurationMs,
      };
      lastRender = { result, at: Date.now() };
      if (renderResolve) {
        const r = renderResolve;
        renderResolve = null;
        if (renderTimer) clearTimeout(renderTimer);
        r(result);
      }
    }
  }

  window.addEventListener("message", listener);

  function send(payload: Record<string, unknown>): boolean {
    const iframe = getIframe();
    const win = iframe?.contentWindow;
    if (!win) return false;
    payload.__recorder = true;
    try {
      win.postMessage(payload, "*");
      return true;
    } catch {
      return false;
    }
  }

  function awaitReply<T>(
    expected: "ack" | "snapshot.result",
    id: number,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("bridge timeout"));
      }, timeoutMs);
      pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        kind: expected,
      });
    });
  }

  return {
    async dispatch(action, timeoutMs) {
      const id = nextId++;
      if (!send({ op: "dispatch", id, action })) {
        return { ok: false, reason: "iframe-not-ready" };
      }
      try {
        return await awaitReply<AckResult>("ack", id, timeoutMs);
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    },
    async ping(timeoutMs) {
      const id = nextId++;
      if (!send({ op: "ping", id })) return false;
      try {
        const ack = await awaitReply<AckResult>("ack", id, timeoutMs);
        return ack.ok;
      } catch {
        return false;
      }
    },
    async snapshot(timeoutMs) {
      const id = nextId++;
      if (!send({ op: "snapshot", id })) {
        return { html: "", errors: ["iframe-not-ready"] };
      }
      try {
        return await awaitReply<SnapshotResult>(
          "snapshot.result",
          id,
          timeoutMs,
        );
      } catch {
        return { html: "", errors: ["timeout"] };
      }
    },
    awaitRenderComplete(timeoutMs) {
      // If a render.complete arrived recently, resolve immediately —
      // covers the case where the player set up the await *after* the
      // render happened (common when execute() chains mcpCall + render).
      if (lastRender && Date.now() - lastRender.at < RENDER_TTL_MS) {
        const result = lastRender.result;
        lastRender = null;
        return Promise.resolve(result);
      }
      return new Promise<RenderCompleteResult>((resolve, reject) => {
        renderResolve = resolve;
        renderTimer = setTimeout(() => {
          renderResolve = null;
          reject(new Error("render.complete timeout"));
        }, timeoutMs);
      });
    },
    destroy() {
      window.removeEventListener("message", listener);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("bridge destroyed"));
      }
      pending.clear();
      if (renderTimer) clearTimeout(renderTimer);
      renderResolve = null;
    },
  };
}
