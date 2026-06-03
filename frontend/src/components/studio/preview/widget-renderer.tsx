import { useEffect, useRef, useState } from "react";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { renderHtml } from "@/lib/core/widget/render-html";
import { createClaudeMock } from "@/lib/studio/mock-claude";
import { callTool } from "@/lib/studio/api";
import { extractCspDomains } from "@/lib/core/csp/profiles";
import { analyze } from "@/lib/core/csp/analyze";
import { stripTunnelUrls } from "@/lib/core/widget/inject";
import { getWidgetColors } from "@/lib/core/widget/colors";
import type { CspFinding } from "@/lib/core/csp/types";
import { eventBus, WidgetRenderEvent } from "@/lib/event";
import { WidgetClickAction } from "@/lib/action/widget_click";
import { WidgetTextInputAction } from "@/lib/action/widget_text_input";
import { captureSelector } from "@/lib/action/capture-selector";
import { recorder } from "@/lib/recorder/recorder";
import { useProfileStore } from "@/lib/studio/stores/profile-store";

function findingToViolation(finding: CspFinding, sourceFile: string) {
  return {
    id: `static_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toTimeString().split(" ")[0],
    directive: finding.directive,
    blockedUri: finding.blocked,
    sourceFile,
    lineNumber: finding.line || 0,
    columnNumber: 0,
    source: "static" as const,
    fix: finding.fix,
    severity: finding.severity,
    platforms: finding.platforms,
    snippet: finding.snippet,
  };
}

function isTextLikeInput(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const t = ((el as HTMLInputElement).type ?? "text").toLowerCase();
    return ![
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "file",
      "image",
      "range",
      "color",
      "hidden",
    ].includes(t);
  }
  return false;
}

export function WidgetRenderer({ widgetId }: { widgetId?: string } = {}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [autoHeight, setAutoHeight] = useState<number | null>(null);

  const activeWidgetId = useWidgetStore((s) => s.activeWidgetId);
  const targetId = widgetId ?? activeWidgetId;
  const entry = useWidgetStore((s) =>
    targetId ? (s.widgets[targetId] ?? null) : null,
  );
  const platform = useWidgetStore((s) => s.platform);
  const strictMode = useWidgetStore((s) => s.strictMode);
  const addConsoleEntry = useWidgetStore((s) => s.addConsoleEntry);
  const logAction = useWidgetStore((s) => s.logAction);
  const addPendingMessage = useWidgetStore((s) => s.addPendingMessage);
  const getViewportSize = useWidgetStore((s) => s.getViewportSize);
  const addCspViolation = useWidgetStore((s) => s.addCspViolation);
  const profileName = useProfileStore((s) => {
    const profile = s.profiles.find((p) => p.id === s.activeProfileId);
    return profile?.name ?? null;
  });
  const theme = useWidgetStore((s) => s.theme);

  useEffect(() => {
    setAutoHeight(null);
  }, [targetId]);

  // Publish iframe ref so other store consumers (mock-claude.ts,
  // WidgetClickAction) can reach it. We use a ref callback rather than a
  // `useEffect(() => …, [])` because the <iframe> is conditionally
  // rendered (only when a widget is active + the preview tab is open).
  // The [] effect would fire once at component mount with iframeRef.current
  // still null (the iframe hasn't appeared yet) and never re-publish — so
  // store._iframeRef would stay null forever. The ref callback fires
  // every time the iframe element mounts/unmounts, so the store always
  // matches the live DOM.
  const setIframe = (el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
    useWidgetStore.setState({ _iframeRef: el });
  };

  // Forward console messages from iframe to studio console, and bridge
  // legacy-OpenAI `window.openai.callTool` calls through the real MCP.
  useEffect(() => {
    const handleMessage = async (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;
      if (data.type === "studio_console") {
        addConsoleEntry(data.level, data.args);
        return;
      }
      if (
        data.type === "studio_content_height" &&
        typeof data.height === "number"
      ) {
        setAutoHeight(data.height);
        return;
      }
      if (
        data.type === "studio_action" &&
        data.method === "callTool" &&
        data.callId
      ) {
        const iframe = iframeRef.current;
        const args = data.args as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const name = args?.name || "";
        const toolArgs = args?.arguments || {};
        logAction("callTool", { name, arguments: toolArgs });
        try {
          const result = await callTool(name, toolArgs);
          logAction("callTool:result", { name, result });
          iframe?.contentWindow?.postMessage(
            { type: "studio_tool_result", callId: data.callId, result },
            "*",
          );
        } catch (err) {
          logAction("callTool:error", { name, error: (err as Error).message });
          iframe?.contentWindow?.postMessage(
            {
              type: "studio_tool_result",
              callId: data.callId,
              result: { error: (err as Error).message },
            },
            "*",
          );
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [addConsoleEntry, logAction]);

  // Mount + snapshot effect — fires when the target entry changes.
  useEffect(() => {
    if (!targetId || !entry) return;
    if (entry.snapshot !== null) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;

    const { html: finalHtml } = renderHtml({
      html: entry.html,
      mock: entry.mock,
      platform,
      strict: strictMode,
    });

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(finalHtml);
    doc.close();

    const cspDomains = extractCspDomains(
      (entry.mock._meta || {}) as Record<string, unknown>,
    );
    const { findings } = analyze(stripTunnelUrls(entry.html), cspDomains);
    for (const finding of findings) {
      addCspViolation(findingToViolation(finding, targetId));
    }

    const prev = useWidgetStore.getState()._extAppsMock;
    if (prev) {
      prev.destroy();
      useWidgetStore.setState({ _extAppsMock: null });
    }
    const extAppsMock = createClaudeMock(
      iframe,
      entry.mock,
      (method, args) => logAction(method, args),
      (name, args) => callTool(name, args),
      platform === "claude"
        ? (content) => addPendingMessage("claude", content)
        : undefined,
    );
    useWidgetStore.setState({ _extAppsMock: extAppsMock });

    const timer = setTimeout(() => {
      const snap = doc.documentElement.outerHTML;
      useWidgetStore.getState().setSnapshot(targetId, snap);
      const meta = entry.mock?._meta as Record<string, unknown> | undefined;
      const ui = meta?.ui as Record<string, unknown> | undefined;
      const uri =
        (typeof ui?.resourceUri === "string" && ui.resourceUri) ||
        (typeof ui?.uri === "string" && ui.uri) ||
        (typeof meta?.["openai/outputTemplate"] === "string" &&
          (meta["openai/outputTemplate"] as string)) ||
        targetId;
      eventBus.emit(new WidgetRenderEvent(targetId, uri, { success: true }));
    }, entry.waitMs);

    return () => {
      clearTimeout(timer);
      extAppsMock?.destroy();
    };
  }, [
    targetId,
    entry,
    platform,
    strictMode,
    logAction,
    addPendingMessage,
    addCspViolation,
  ]);

  // Click capture — own effect, depends only on `targetId`.
  useEffect(() => {
    if (!targetId) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    const onClick = (e: Event) => {
      if (!recorder.isCapturing()) return;
      const target = e.target as Element | null;
      if (!target) return;
      if (isTextLikeInput(target)) return;
      const liveDoc = iframe.contentDocument ?? doc;
      const candidates = captureSelector(target, liveDoc);
      if (candidates.length === 0) return;
      const fallbackText =
        (target.textContent || "").trim().slice(0, 40) || undefined;

      const prev = useWidgetStore.getState().openClick;
      if (prev) prev.close();
      const prevText = useWidgetStore.getState().openTextInput;
      if (prevText) prevText.close();

      const action = new WidgetClickAction(targetId, candidates, fallbackText);
      eventBus.setActive(action);
      void action
        .recordFromUserClick(liveDoc, {
          matchedSelector: candidates[0],
          matchedIndex: 0,
        })
        .then(() => {
          if (eventBus.current() === action) eventBus.setActive(null);
          recorder.record(action, { stateChange: action.change() });
          action.markRecorded();
        });
    };

    doc.addEventListener("click", onClick, { capture: true });
    return () => {
      doc.removeEventListener("click", onClick, { capture: true });
      const open = useWidgetStore.getState().openClick;
      if (open) open.close();
    };
  }, [targetId]);

  // Keyboard capture — own effect, same dep as click capture.
  useEffect(() => {
    if (!targetId) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    let currentEl: Element | null = null;

    const onKeyup = (e: KeyboardEvent) => {
      if (!recorder.isCapturing()) return;
      if (e.key.length !== 1 && e.key !== "Backspace" && e.key !== "Delete")
        return;
      const target = e.target as Element | null;
      if (!target || !isTextLikeInput(target)) return;

      const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
      const liveDoc = iframe.contentDocument ?? doc;
      const openTextInput = useWidgetStore.getState().openTextInput;

      if (openTextInput && currentEl === target) {
        openTextInput.updateValue(inputEl.value);
        return;
      }

      if (openTextInput) openTextInput.close();
      currentEl = target;

      const candidates = captureSelector(target, liveDoc);
      if (candidates.length === 0) return;

      const action = new WidgetTextInputAction(
        targetId,
        candidates,
        inputEl.value,
      );
      eventBus.setActive(action);
      void action
        .recordFromUserInput(liveDoc, {
          matchedSelector: candidates[0],
          matchedIndex: 0,
          initialValue: inputEl.value,
        })
        .then(() => {
          if (eventBus.current() === action) eventBus.setActive(null);
          recorder.record(action, { stateChange: action.change() });
          action.markRecorded();
          if (currentEl === target) currentEl = null;
        });
    };

    doc.addEventListener("keyup", onKeyup, { capture: true });
    return () => {
      doc.removeEventListener("keyup", onKeyup, { capture: true });
      const open = useWidgetStore.getState().openTextInput;
      if (open) open.close();
    };
  }, [targetId]);

  const viewportSize = getViewportSize();
  const widgetColors = getWidgetColors(platform);
  const displayHeight = autoHeight
    ? Math.min(autoHeight, viewportSize.height)
    : viewportSize.height;

  const isDark = theme === "dark";
  const headerBg = isDark ? "#1a1a1a" : "#f5f5f5";
  const headerBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const headerText = isDark ? "#e5e5e5" : "#111111";
  const avatarLetter = profileName ? profileName[0].toUpperCase() : "A";

  const meta = (entry?.mock?._meta ?? {}) as Record<string, unknown>;
  const ui = meta.ui as Record<string, unknown> | undefined;
  const showBorder = ui?.prefersBorder === true;

  return (
    <div
      style={{
        width: viewportSize.width,
        height: displayHeight,
        maxWidth: "100%",
        backgroundColor: widgetColors.background,
        border: showBorder ? `1px solid ${headerBorder}` : undefined,
        borderRadius: "0.5rem",
        overflow: "hidden",
      }}
      className="shrink-0"
    >
      {/* App header */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{
          backgroundColor: headerBg,
          borderBottom: `1px solid ${headerBorder}`,
        }}
      >
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-semibold shrink-0"
          style={{
            backgroundColor: isDark ? "#333333" : "#d4d4d4",
            color: headerText,
          }}
        >
          {avatarLetter}
        </div>
        <span
          className="text-xs font-medium truncate"
          style={{ color: headerText }}
        >
          {profileName ?? "App"}
        </span>
      </div>
      <iframe
        ref={setIframe}
        style={{ height: viewportSize.height }}
        className="w-full block"
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
        title="Widget Preview"
      />
    </div>
  );
}
