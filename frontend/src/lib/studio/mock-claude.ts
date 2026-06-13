import type { MockData } from "./mock-openai";
import { CONFIG } from "@/lib/config";

export interface ExtAppsMockOptions {
  iframe: HTMLIFrameElement;
  mock: MockData;
  onAction: (method: string, args: unknown) => void;
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  onMessage?: (content: unknown) => void;
  /** Host name shown in ui/initialize response (default: "mcp-studio") */
  hostName?: string;
  /** Called when the widget sends ui/initialize — signals ext-apps protocol usage */
  onProtocolDetected?: () => void;
  /** Called when the widget requests a display mode change and it is honored */
  onDisplayModeChange?: (mode: string) => void;
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
    hostName = "mcp-studio",
    onProtocolDetected,
    onDisplayModeChange,
  } = opts;
  let currentMock = { ...mock };
  let widgetAvailableModes: string[] = ["inline", "fullscreen"];

  // Canonical display modes per MCP Apps spec: "inline" | "fullscreen" | "pip"
  // "compact" is the legacy OpenAI alias for "inline"
  function toClaudeDisplayMode(mode: string): string {
    if (mode === "fullscreen" || mode === "pip") return mode;
    return "inline";
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

    if (!msg || msg.jsonrpc !== "2.0") return;

    // Request (has id + method)
    if (msg.id !== undefined && msg.method) {
      const { id, method, params = {} } = msg;

      switch (method) {
        case "initialize":
        case "ui/initialize": {
          onProtocolDetected?.();
          const appCaps = (
            params as { appCapabilities?: { availableDisplayModes?: string[] } }
          ).appCapabilities;
          if (appCaps?.availableDisplayModes?.length) {
            widgetAvailableModes = appCaps.availableDisplayModes;
          }
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
          setTimeout(() => sendToolData(), CONFIG.TIMEOUT_DEFERRED_APPLY);
          break;
        }

        case "ui/message":
          onAction("sendMessage", params);
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
          sendResponse(id, {});
          break;

        case "ui/open-link":
        case "ui/openLink":
          onAction("openLink", params);
          {
            const url = (params as { url?: string }).url;
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          }
          sendResponse(id, {});
          break;

        case "ui/request-display-mode":
        case "ui/requestDisplayMode": {
          const raw = (params as { mode?: string }).mode || "inline";
          const requested = toClaudeDisplayMode(raw); // normalize "compact" → "inline"
          const honored = widgetAvailableModes
            .map(toClaudeDisplayMode)
            .includes(requested)
            ? requested
            : toClaudeDisplayMode(currentMock.displayMode);
          sendResponse(id, { mode: honored });
          if (honored === requested) {
            currentMock = { ...currentMock, displayMode: honored };
            onDisplayModeChange?.(honored);
            sendNotification("ui/notifications/host-context-changed", {
              theme: currentMock.theme,
              displayMode: honored,
              locale: currentMock.locale,
              availableDisplayModes: ["inline", "fullscreen"],
            });
          }
          onAction("requestDisplayMode", { requested, honored });
          break;
        }

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

export function createClaudeMock(
  iframe: HTMLIFrameElement,
  mock: MockData,
  onAction: (method: string, args: unknown) => void,
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>,
  onMessage?: (content: unknown) => void,
  onDisplayModeChange?: (mode: string) => void,
) {
  return createExtAppsMock({
    iframe,
    mock,
    onAction,
    onToolCall,
    onMessage,
    onDisplayModeChange,
    hostName: "mcp-studio",
  });
}
