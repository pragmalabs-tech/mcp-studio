import type { MockData } from "./mock-openai";
import { recorder } from "../recorder/bus";
import { isBridgeMessage } from "../recorder/bridge-protocol";

export interface ExtAppsMockOptions {
  iframe: HTMLIFrameElement;
  mock: MockData;
  onAction: (method: string, args: unknown) => void;
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  onMessage?: (content: unknown) => void;
  /** Host name shown in ui/initialize response (default: "mcpr-studio") */
  hostName?: string;
  /** Called when the widget sends ui/initialize — signals ext-apps protocol usage */
  onProtocolDetected?: () => void;
}

/**
 * MCP Apps ext-apps mock — handles JSON-RPC 2.0 postMessage protocol.
 * Used for both Claude and OpenAI (new ext-apps mode).
 */
export function createExtAppsMock(opts: ExtAppsMockOptions) {
  const {
    iframe,
    mock,
    onAction,
    onToolCall,
    onMessage,
    hostName = "mcpr-studio",
    onProtocolDetected,
  } = opts;
  let currentMock = { ...mock };
  // Tracks whether `ui/initialize` (or `initialize`) round-tripped through
  // this host. The widget bridge JS has no reliable way to set its own flag
  // (the SDK that would set `window.__mcprBridgeHandshakeOk` doesn't exist
  // in studio's mock environment), so the host is the source of truth.
  // Used to override the (always-false) `handshakeOk` in render.complete
  // forwards to the recorder bus.
  let protocolHandshaked = false;

  // Claude only accepts "inline" | "fullscreen" | "pip" as displayMode
  function toClaudeDisplayMode(mode: string): string {
    if (mode === "fullscreen" || mode === "pip") return mode;
    return "inline"; // "compact" and others map to "inline"
  }

  function sendResponse(id: string | number, result: unknown) {
    iframe.contentWindow?.postMessage({ jsonrpc: "2.0", id, result }, "*");
  }

  function sendNotification(method: string, params: unknown) {
    iframe.contentWindow?.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  function sendToolData() {
    sendNotification("ui/notifications/host-context-changed", {
      theme: currentMock.theme,
      displayMode: toClaudeDisplayMode(currentMock.displayMode),
      locale: currentMock.locale,
      availableDisplayModes: ["inline", "fullscreen"],
    });

    if (
      currentMock.toolInput &&
      Object.keys(currentMock.toolInput as object).length > 0
    ) {
      sendNotification("ui/notifications/tool-input", {
        arguments: currentMock.toolInput,
      });
    }

    sendNotification("ui/notifications/tool-result", {
      content: [{ type: "text", text: JSON.stringify(currentMock.toolOutput) }],
      structuredContent: currentMock.toolOutput,
      _meta: currentMock._meta || {},
    });

    onAction("system", "Tool data injected");
  }

  function handleMessage(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data;

    // Recorder bridge messages bypass JSON-RPC dispatch. Capture events feed
    // the recorder bus; ack / snapshot.result are claimed by the host-side
    // BridgeClient and ignored here. render.complete is forwarded to the bus
    // so it appears in the timeline as an observation action.
    if (isBridgeMessage(msg)) {
      if ("op" in msg) {
        if (msg.op === "render.complete") {
          // Always emit. The bus persists to the recorded timeline only
          // while in recording mode; listeners fire regardless, which is
          // how the engine's replay observation sees render.complete.
          recorder.emit({
            kind: "widget.render.complete",
            bodyChars: msg.bodyChars,
            hasRuntimeErrors: msg.hasRuntimeErrors,
            // Host-authoritative handshake signal. `msg.handshakeOk` from
            // the bridge JS is structurally always false in studio (the
            // ext-apps SDK that would set the iframe global isn't present).
            // OR with the host's own observation so the recorded timeline
            // reflects whether `ui/initialize` actually round-tripped.
            handshakeOk: protocolHandshaked || msg.handshakeOk,
            renderDurationMs: msg.renderDurationMs,
          });
        }
        // ack / snapshot.result handled elsewhere (BridgeClient).
        return;
      }
      // DOM capture events flow to the bus on every interaction. Bus
      // persistence is gated on its mode; listeners fire regardless so
      // replay observation can react to them.
      switch (msg.kind) {
        case "widget.dom.click":
          recorder.emit({
            kind: "widget.dom.click",
            selectors: msg.selectors,
            mutated: msg.mutated,
          });
          break;
        case "widget.dom.input":
          recorder.emit({
            kind: "widget.dom.input",
            selectors: msg.selectors,
            value: msg.value,
            inputType: msg.inputType,
          });
          break;
        case "widget.dom.change":
          recorder.emit({
            kind: "widget.dom.change",
            selectors: msg.selectors,
            value: msg.value,
          });
          break;
        case "widget.dom.submit":
          recorder.emit({
            kind: "widget.dom.submit",
            selectors: msg.selectors,
          });
          break;
        case "widget.dom.keydown":
          recorder.emit({
            kind: "widget.dom.keydown",
            selectors: msg.selectors,
            key: msg.key,
            code: msg.code,
            mods: msg.mods,
          });
          break;
      }
      return;
    }

    if (!msg || msg.jsonrpc !== "2.0") return;

    // Request (has id + method)
    if (msg.id !== undefined && msg.method) {
      const { id, method, params = {} } = msg;

      switch (method) {
        case "initialize":
        case "ui/initialize":
          protocolHandshaked = true;
          onProtocolDetected?.();
          sendResponse(id, {
            protocolVersion: "2026-01-26",
            hostInfo: { name: hostName, version: "1.0.0" },
            hostCapabilities: {
              openLinks: {},
              serverTools: {},
              logging: {},
              updateModelContext: { text: {}, structuredContent: {} },
              message: { text: {} },
              displayMode: { inline: {}, fullscreen: {} },
            },
            hostContext: {
              theme: currentMock.theme,
              displayMode: toClaudeDisplayMode(currentMock.displayMode),
              locale: currentMock.locale,
              availableDisplayModes: ["inline", "fullscreen"],
            },
          });
          onAction("ext-apps:init", "Handshake complete");
          setTimeout(() => sendToolData(), 50);
          break;

        case "ui/message":
          onAction("sendMessage", params);
          recorder.emit({
            kind: "widget.intent",
            name: "ui/message",
            params,
          });
          if (onMessage) onMessage(params);
          sendResponse(id, {});
          break;

        case "ui/call-server-tool":
        case "ui/callServerTool":
        case "tools/call":
          onAction("callServerTool", params);
          if (onToolCall) {
            const toolParams = params as {
              name?: string;
              arguments?: Record<string, unknown>;
            };
            const toolName = toolParams.name || "";
            const toolArgs = toolParams.arguments || {};
            onToolCall(toolName, toolArgs)
              .then((result) => {
                const content = result as {
                  content?: Array<{ type: string; text?: string }>;
                  meta?: Record<string, unknown>;
                };
                if (content.content) {
                  sendResponse(id, { content: content.content });
                } else {
                  sendResponse(id, {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                  });
                }
                onAction("callServerTool:result", { name: toolName, result });
              })
              .catch((err) => {
                sendResponse(id, {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({ error: (err as Error).message }),
                    },
                  ],
                  isError: true,
                });
                onAction("callServerTool:error", {
                  name: toolName,
                  error: (err as Error).message,
                });
              });
          } else {
            sendResponse(id, {
              content: [{ type: "text", text: "{}" }],
            });
          }
          break;

        case "ui/update-model-context":
        case "ui/updateModelContext":
          onAction("updateModelContext", params);
          recorder.emit({
            kind: "widget.intent",
            name: "ui/update-model-context",
            params,
          });
          sendResponse(id, {});
          break;

        case "ui/open-link":
        case "ui/openLink":
          onAction("openLink", params);
          recorder.emit({
            kind: "widget.intent",
            name: "ui/open-link",
            params,
          });
          {
            const url = (params as { url?: string }).url;
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          }
          sendResponse(id, {});
          break;

        case "ui/request-display-mode":
        case "ui/requestDisplayMode":
          onAction("requestDisplayMode", params);
          recorder.emit({
            kind: "widget.intent",
            name: "ui/request-display-mode",
            params,
          });
          sendResponse(id, {
            mode: (params as { mode?: string }).mode || "inline",
          });
          break;

        case "notifications/size-changed":
        case "ui/sendSizeChanged":
          if ((params as { height?: number }).height) {
            iframe.style.height = `${(params as { height: number }).height}px`;
          }
          sendResponse(id, {});
          break;

        case "ui/sendLog":
        case "logging/setLevel":
          if ((params as { data?: unknown }).data)
            onAction("widget:log", params);
          sendResponse(id, {});
          break;

        default:
          onAction("ext-apps:unknown", { method, params });
          sendResponse(id, {});
          break;
      }
    }
    // Notification from widget
    else if (msg.method) {
      onAction("ext-apps:notify", { method: msg.method, params: msg.params });
      recorder.emit({
        kind: "widget.intent",
        name: String(msg.method),
        params: msg.params,
      });
    }
  }

  window.addEventListener("message", handleMessage);

  return {
    update(newMock: MockData) {
      currentMock = { ...newMock };
      sendToolData();
    },
    destroy() {
      window.removeEventListener("message", handleMessage);
    },
  };
}

/** Backward-compatible wrapper — same signature as before. */
export function createClaudeMock(
  iframe: HTMLIFrameElement,
  mock: MockData,
  onAction: (method: string, args: unknown) => void,
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>,
  onMessage?: (content: unknown) => void,
) {
  return createExtAppsMock({
    iframe,
    mock,
    onAction,
    onToolCall,
    onMessage,
    hostName: "mcpr-studio",
  });
}
