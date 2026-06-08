import { serializeIframeDocument, type WidgetSnapshot } from "./snapshot";

export type WidgetId = string;
export type SnapshotId = string;

export function getWidgetIframe(widgetId: WidgetId): HTMLIFrameElement | null {
  return document.getElementById(
    `widget-iframe-${widgetId}`,
  ) as HTMLIFrameElement | null;
}

type SnapshotCenterRegisterItem = {
  id: SnapshotId;
  widgetId: WidgetId;
  timeout_ms: number;
  result?: WidgetSnapshot;
  isProcessing: boolean;
};

type ISnapshotCenterRegister = {
  [key: SnapshotId]: SnapshotCenterRegisterItem;
};

class SnapshotCenterRegister {
  private _register: ISnapshotCenterRegister = {};
  private _timeoutFns: Record<SnapshotId, number> = {};

  register(id: SnapshotId, widgetId: WidgetId, timeout_ms: number): void {
    if (this._register[id]) {
      console.warn(`Snapshot already registered for ${id}, skipping`);
      return;
    }

    this._register[id] = { id, widgetId, timeout_ms, isProcessing: false };
    this._timeoutFns[id] = setTimeout(() => {
      const data = this._register[id];
      if (data) {
        extractDataForSnapshot(data);
      } else {
        console.log("Cannot find data for snapshot", id);
      }
    }, timeout_ms);
  }

  takeSnapshot(id: SnapshotId): void {
    const data = this._register[id];
    if (!data) {
      console.log("Cannot find data for snapshot", id);
      return;
    }

    if (this._timeoutFns[id] !== undefined) {
      clearTimeout(this._timeoutFns[id]);
      delete this._timeoutFns[id];
    }

    extractDataForSnapshot(data);
  }

  getResult(id: SnapshotId): WidgetSnapshot | undefined {
    return this._register[id]?.result;
  }
}

function extractDataForSnapshot(data: SnapshotCenterRegisterItem) {
  if (data.result) {
    console.warn(`Already take snapshot for ${data.id}`);
    return;
  }

  if (data.isProcessing) {
    console.warn(`Snapshot is processing for ${data.id}`);
    return;
  }

  const iframe = getWidgetIframe(data.widgetId);
  if (!iframe) {
    console.warn(
      `Cannot find iframe for widget ${data.widgetId} (snapshot ${data.id})`,
    );
    return;
  }

  data.isProcessing = true;
  const snapshot = serializeIframeDocument(data.id, iframe);
  data.result = snapshot;
}

export const snapshotCenter = new SnapshotCenterRegister();
