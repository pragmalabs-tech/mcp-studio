import { Action } from "./types";
import { readResource } from "@/lib/studio/api";
import type { StateChange } from "@/lib/state/types";
import type { AssertablePoint } from "@/lib/assertion/types";
import { useStudioStore } from "@/lib/studio/store";

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
    const store = useStudioStore.getState();
    store.logAction("system", `Executing resource ${this.data.uri}…`);

    try {
      const result = await readResource(this.data.uri);
      this.setResult(true, result);
      store.logAction("resources/read", { uri: this.data.uri, result });

      useStudioStore.setState({
        lastResult: result,
        jsonOutput: JSON.stringify(result, null, 2),
      });
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
