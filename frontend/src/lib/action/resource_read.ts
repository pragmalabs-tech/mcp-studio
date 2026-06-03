import { Action } from "./types";
import { readResource } from "@/lib/studio/api";
import type { StateChange } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export class ResourceReadAction extends Action<{ uri: string }> {
  static assertablePoints: AssertablePoint[] = [
    {
      key: "success",
      label: "Success flag",
      path: "success",
      defaultMode: "exact",
      supportedModes: ["exact", "ignore"],
    },
    {
      key: "contents",
      label: "Contents",
      path: "data.contents",
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

  constructor(uri: string) {
    super("RESOURCE_READ", { uri });
  }

  async execute(): Promise<void> {
    const store = useWidgetStore.getState();
    store.logAction("system", `Executing resource ${this.data.uri}…`);

    try {
      const result = await readResource(this.data.uri);
      this.setResult(true, result);
      store.logAction("resources/read", { uri: this.data.uri, result });

      useWidgetStore.setState({
        lastResult: result,
        jsonOutput: JSON.stringify(result, null, 2),
      });

      // If the resource returned HTML content, load it into the widget iframe
      // so the existing MCP Apps mock protocol (postMessage) can be used.
      const res = result as {
        contents?: { mimeType?: string; text?: string }[];
      };
      const first = res?.contents?.[0];
      if (first?.mimeType?.includes("text/html") && first.text) {
        const { theme, locale, displayMode } = useWidgetStore.getState();
        store.insertWidget(this.data.uri, {
          html: first.text,
          mock: {
            toolInput: {},
            toolOutput: {},
            _meta: {},
            widgetState: null,
            theme,
            locale,
            displayMode,
          },
          waitMs: 0,
        });
      }
    } catch (err) {
      const message = errorMessage(err);
      store.logAction("error", message);
      this.setResult(false, undefined, { message });
    }
  }

  change(): StateChange {
    const success = this.result?.success ?? false;
    return {
      resources: { [this.data.uri]: { readCount: 1 } },
      network: {
        requestCount: 1,
        responseCount: success ? 1 : 0,
        errorCount: success ? 0 : 1,
      },
    };
  }
}
