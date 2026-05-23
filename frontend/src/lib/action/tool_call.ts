import { Action } from "./types";
import { callTool } from "@/lib/studio/api";
import type { StateChange } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export class ToolCallAction extends Action<{
  tool: string;
  params: unknown;
}> {
  /**
   * Defaults are strict (`exact`) for every point — users opt into
   * `flaky` / `shape` / `ignore` per field via the assertion config
   * when a tool returns server-generated values that aren't worth
   * comparing strictly.
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
      path: "data.isError",
      defaultMode: "exact",
      supportedModes: ["exact", "ignore"],
    },
    {
      key: "structuredContent",
      label: "Structured content",
      path: "data.structuredContent",
      defaultMode: "exact",
      supportedModes: ["exact", "shape", "flaky", "ignore"],
    },
    {
      key: "content",
      label: "Content blocks",
      path: "data.content",
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
  ];

  constructor(tool: string, params: unknown) {
    super("TOOL_CALL", { tool, params });
  }

  async execute(): Promise<void> {
    try {
      const result = await callTool(
        this.data.tool,
        (this.data.params as Record<string, unknown>) ?? {},
      );
      this.setResult(true, result);
    } catch (err) {
      this.setResult(false, undefined, { message: errorMessage(err) });
    }
  }

  change(): StateChange {
    const success = this.result?.success ?? false;
    return {
      tools: { [this.data.tool]: { callCount: 1 } },
      network: {
        requestCount: 1,
        responseCount: success ? 1 : 0,
        errorCount: success ? 0 : 1,
      },
    };
  }
}
