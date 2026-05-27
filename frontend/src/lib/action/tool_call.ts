import { Action } from "./types";
import { callTool, readResource } from "@/lib/studio/api";
import type { StateChange } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";
import { useStudioStore } from "@/lib/studio/store";
import { validateToolResult } from "@/lib/studio/validate-tool-result";
import { raceWithTimeout } from "@/lib/core/util/race-with-timeout";
import { buildMockFromResponse, resolveWidgetUri } from "./widget-helpers";

const DEFAULT_WAIT_MS = 150;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Outcome data carried on `action.result.data`. Wraps the raw tool
 * response under `.tool` so the widget render result has a peer slot
 * instead of being smuggled in via side-effects.
 */
export interface ToolCallResult {
  /** Raw `tools/call` response from the MCP server. */
  tool: unknown;
  /** Resolved `ui://` URI when the response asked for a widget render,
   *  null otherwise. Comparable across runs — same intent = same URI.
   *  Also used as the key in `state.widgets` (stable, no separate UUID). */
  widget: string | null;
  /** Post-render `outerHTML` of the iframe captured after `waitMs`.
   *  Review artifact only — never string-compared in assertions. Null
   *  when no widget rendered or when `<WidgetPreview>` didn't resolve
   *  (component unmounted, timeout). */
  snapshot: string | null;
}

export class ToolCallAction extends Action<{
  tool: string;
  params: unknown;
  /** Wall-clock delay between iframe mount and snapshot capture.
   *  Recorded so replay reuses the same timing; editable on saved
   *  recordings. Default 150ms. */
  waitMs?: number;
}> {
  /**
   * Defaults are strict (`exact`) for every point — users opt into
   * `flaky` / `shape` / `ignore` per field via the assertion config
   * when a tool returns server-generated values that aren't worth
   * comparing strictly.
   *
   * Paths reach into `data.tool.*` now that the outcome is wrapped.
   * The `widget` URI is the comparable "did the same widget render?"
   * signal; `snapshot` is intentionally not a point.
   */
  static assertablePoints: AssertablePoint[] = [
    {
      key: "success",
      label: "Success flag",
      path: "success",
      defaultMode: "exact",
      supportedModes: ["exact", "ignore"],
    },
    {
      key: "isError",
      label: "Error flag",
      path: "data.tool.isError",
      defaultMode: "exact",
      supportedModes: ["exact", "ignore"],
    },
    {
      key: "structuredContent",
      label: "Structured content",
      path: "data.tool.structuredContent",
      defaultMode: "exact",
      supportedModes: ["exact", "shape", "flaky", "ignore"],
    },
    {
      key: "content",
      label: "Content blocks",
      path: "data.tool.content",
      defaultMode: "exact",
      supportedModes: ["exact", "shape", "flaky", "ignore"],
    },
    {
      key: "errorMessage",
      label: "Error message",
      path: "error.message",
      defaultMode: "exact",
      supportedModes: ["exact", "shape", "ignore"],
    },
    {
      key: "widget",
      label: "Widget URI",
      path: "data.widget",
      defaultMode: "exact",
      supportedModes: ["exact", "ignore"],
    },
  ];

  constructor(tool: string, params: unknown, waitMs?: number) {
    super(
      "TOOL_CALL",
      waitMs === undefined ? { tool, params } : { tool, params, waitMs },
    );
  }

  async execute(): Promise<void> {
    const store = useStudioStore.getState();
    store.logAction("system", `Executing tool ${this.data.tool}…`);

    try {
      // ── MCP call ──
      const toolResponse = await callTool(
        this.data.tool,
        (this.data.params as Record<string, unknown>) ?? {},
      );
      store.logAction("tools/call", {
        name: this.data.tool,
        result: toolResponse,
      });

      // ── Spec-compliance validation ──
      const issues = validateToolResult(toolResponse);
      if (issues.length > 0) {
        useStudioStore.setState({ resultIssues: issues });
        for (const issue of issues) {
          store.logAction(
            issue.severity === "error" ? "error" : "warn",
            `${issue.title} - ${issue.detail}`,
          );
        }
      }

      // ── Widget resolution + render ──
      const meta = ((toolResponse as { _meta?: Record<string, unknown> })
        ?._meta ??
        (toolResponse as { meta?: Record<string, unknown> })?.meta ??
        {}) as Record<string, unknown>;
      const liveStore = useStudioStore.getState();
      const widgetUri = resolveWidgetUri(
        meta,
        this.data.tool,
        liveStore.resources,
      );

      let snapshot: string | null = null;

      if (widgetUri) {
        // Prefer the prefetched cache (loadAll fills it); fall back to a
        // live read so widgets that arrived after loadAll still render.
        let html = liveStore.widgetCache[widgetUri] ?? "";
        if (!html) {
          try {
            const res = (await readResource(widgetUri)) as {
              contents?: { text?: string }[];
            };
            html = res?.contents?.[0]?.text ?? "";
            if (html) {
              useStudioStore.setState((s) => ({
                widgetCache: { ...s.widgetCache, [widgetUri]: html },
              }));
            }
          } catch (err) {
            store.logAction(
              "warn",
              `Widget HTML fetch failed: ${errorMessage(err)}`,
            );
            html = "";
          }
        }

        if (html.trim().length > 0) {
          const mock = buildMockFromResponse(toolResponse, this.data.params, {
            theme: liveStore.theme,
            locale: liveStore.locale,
            displayMode: liveStore.displayMode,
          });
          const waitMs = this.data.waitMs ?? DEFAULT_WAIT_MS;
          const ready = useStudioStore.getState().insertWidget(widgetUri, {
            html,
            mock,
            waitMs,
          });
          snapshot = await raceWithTimeout(ready, waitMs * 2 + 500, null);
          store.logAction("system", `Widget "${widgetUri}" rendered`);
        } else {
          store.logAction("warn", `Widget "${widgetUri}" HTML missing`);
        }
      }

      // ── UI-facing view state ──
      useStudioStore.setState({
        lastResult: toolResponse,
        jsonOutput: widgetUri ? null : JSON.stringify(toolResponse, null, 2),
      });
      if (!widgetUri) {
        store.logAction("system", "No widget — showing JSON response");
      }

      this.setResult(true, {
        tool: toolResponse,
        widget: widgetUri,
        snapshot,
      } satisfies ToolCallResult);
    } catch (err) {
      const message = errorMessage(err);
      store.logAction("error", message);
      this.setResult(false, undefined, { message });
    }
  }

  change(): StateChange {
    const success = this.result?.success ?? false;
    const widget =
      (this.result?.data as ToolCallResult | undefined)?.widget ?? null;
    const change: StateChange = {
      tools: { [this.data.tool]: { callCount: 1 } },
      network: {
        requestCount: 1,
        responseCount: success ? 1 : 0,
        errorCount: success ? 0 : 1,
      },
    };
    if (widget) {
      change.widgets = { [widget]: { renderCount: 1, clickCount: 0 } };
    }
    return change;
  }
}
