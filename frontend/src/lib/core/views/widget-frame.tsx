/**
 * Self-contained sandboxed iframe that renders widget HTML.
 *
 * Pure mount component: computes `srcdoc` via `renderHtml()`, applies
 * the platform sandbox attribute, and forwards browser events through
 * callback props. Has no store imports - shared by the studio shell,
 * replay viewer, and content dialog.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { getProfile } from "@/lib/core/csp/profiles";
import { renderHtml, type WidgetPlatform } from "@/lib/core/widget/render-html";
import type { MockData } from "@/lib/studio/mock-openai";

const RELAXED_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-forms";

export interface WidgetFrameProps {
  html: string;
  mock: MockData;
  platform: WidgetPlatform;
  strict: boolean;
  /** Rewrites tunnel URLs (only relevant for the live studio render). */
  baseUrl?: string;
  /** Recorder bridge source - injected when set and `strict` is false. */
  bridgeSource?: string;
  /** Receives the iframe element on mount and `null` on unmount. */
  onIframeRef?: (el: HTMLIFrameElement | null) => void;
  /** Forwards `message` events from this iframe (filtered by `event.source`). */
  onPostMessage?: (event: MessageEvent) => void;
  /** Forwards `securitypolicyviolation` events from the iframe document. */
  onCspViolation?: (event: SecurityPolicyViolationEvent) => void;
  /** When true, polls the iframe's documentElement.scrollHeight and resizes. */
  autoResize?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function WidgetFrame(props: WidgetFrameProps) {
  const {
    html,
    mock,
    platform,
    strict,
    baseUrl,
    bridgeSource,
    onIframeRef,
    onPostMessage,
    onCspViolation,
    autoResize = true,
    className,
    style,
  } = props;
  const ref = useRef<HTMLIFrameElement | null>(null);

  const srcdoc = useMemo(
    () =>
      renderHtml({ html, mock, platform, strict, baseUrl, bridgeSource }).html,
    [html, mock, platform, strict, baseUrl, bridgeSource],
  );

  const sandbox = strict ? getProfile(platform).sandbox : RELAXED_SANDBOX;

  const refCallback = useCallback(
    (el: HTMLIFrameElement | null) => {
      ref.current = el;
      onIframeRef?.(el);
    },
    [onIframeRef],
  );

  // Reset inline height when srcdoc changes so auto-resize starts fresh.
  useEffect(() => {
    const el = ref.current;
    if (el && autoResize) el.style.height = "";
  }, [srcdoc, autoResize]);

  // Forward `message` events from this iframe only.
  useEffect(() => {
    if (!onPostMessage) return;
    function handler(event: MessageEvent) {
      if (event.source !== ref.current?.contentWindow) return;
      onPostMessage!(event);
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onPostMessage]);

  // Forward CSP violation events. Tries both the parent document (some
  // violations bubble up) and the iframe document (after load).
  useEffect(() => {
    if (!onCspViolation) return;
    const cb = (e: SecurityPolicyViolationEvent) => onCspViolation(e);
    function attachIframeDoc() {
      try {
        ref.current?.contentDocument?.addEventListener(
          "securitypolicyviolation",
          cb as EventListener,
        );
      } catch {
        /* cross-origin under strict sandbox */
      }
    }
    document.addEventListener("securitypolicyviolation", cb);
    const el = ref.current;
    const onLoad = () => attachIframeDoc();
    el?.addEventListener("load", onLoad);
    attachIframeDoc();
    return () => {
      document.removeEventListener("securitypolicyviolation", cb);
      el?.removeEventListener("load", onLoad);
      try {
        el?.contentDocument?.removeEventListener(
          "securitypolicyviolation",
          cb as EventListener,
        );
      } catch {
        /* ignore */
      }
    };
  }, [onCspViolation]);

  // Auto-resize fallback - adjusts iframe height to fit document.
  useEffect(() => {
    if (!autoResize) return;
    const interval = setInterval(() => {
      try {
        const el = ref.current;
        if (!el?.contentDocument) return;
        const h = el.contentDocument.documentElement.scrollHeight;
        if (h > 50 && Math.abs(el.offsetHeight - h) > 10) {
          el.style.height = `${h}px`;
        }
      } catch {
        /* cross-origin */
      }
    }, 500);
    return () => clearInterval(interval);
  }, [autoResize]);

  return (
    <iframe
      ref={refCallback}
      srcDoc={srcdoc}
      sandbox={sandbox}
      className={className}
      style={style}
      title="widget"
    />
  );
}
