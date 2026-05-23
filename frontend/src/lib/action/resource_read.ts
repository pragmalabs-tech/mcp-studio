import { Action } from "./types";
import { readResource } from "@/lib/studio/api";
import type { StateChange } from "@/lib/state/types";

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
  constructor(uri: string) {
    super("RESOURCE_READ", { uri });
  }

  async execute(): Promise<void> {
    try {
      const result = await readResource(this.data.uri);
      this.setResult(true, result);
    } catch (err) {
      this.setResult(false, undefined, { message: errorMessage(err) });
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
