/**
 * Fullscreen viewer for "click to expand" content.
 *
 * Renders either a sandboxed widget (via WidgetFrame + CSP analysis) or
 * a JSON pretty-print, depending on which shape the caller passes.
 * Mounts fresh on each open; no iframe pool or caching.
 */

import { useMemo } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { analyze } from "@/lib/core/csp/analyze";
import { extractCspDomains } from "@/lib/core/csp/profiles";
import type { MockData } from "@/lib/studio/mock-openai";
import { WidgetFrame } from "./widget-frame";
import { CspFindingsList } from "./csp-findings";
import type { WidgetPlatform } from "@/lib/core/widget/render-html";

export interface ContentDialogWidget {
  html: string;
  mock?: MockData;
  platform?: WidgetPlatform;
  strict?: boolean;
}

export interface ContentDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  /** Render a sandboxed widget. */
  widget?: ContentDialogWidget;
  /** Render arbitrary data as pretty-printed JSON. */
  raw?: unknown;
}

const DEFAULT_MOCK: MockData = {
  toolInput: {},
  toolOutput: {},
  _meta: {},
  widgetState: null,
  theme: "dark",
  locale: "en-US",
  displayMode: "inline",
};

export function ContentDialog({
  open,
  onOpenChange,
  title,
  widget,
  raw,
}: ContentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-[5vh] left-1/2 -translate-x-1/2 z-50 w-[90vw] h-[90vh] bg-popover text-sm border rounded-lg shadow-2xl flex flex-col"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <DialogPrimitive.Title className="text-sm font-medium truncate">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          </header>
          <div className="flex-1 min-h-0 overflow-hidden">
            {widget ? <WidgetBody widget={widget} /> : <RawBody raw={raw} />}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

function WidgetBody({ widget }: { widget: ContentDialogWidget }) {
  const mock = widget.mock ?? DEFAULT_MOCK;
  const platform = widget.platform ?? "claude";
  const strict = widget.strict ?? false;

  const report = useMemo(() => {
    const domains = extractCspDomains(
      (mock._meta || {}) as Record<string, unknown>,
    );
    return analyze(widget.html, domains);
  }, [widget.html, mock]);

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 overflow-auto bg-background">
        <WidgetFrame
          html={widget.html}
          mock={mock}
          platform={platform}
          strict={strict}
          className="border-none block w-full h-full"
          style={{ minHeight: "100%" }}
        />
      </div>
      {report.findings.length > 0 && (
        <aside className="w-80 shrink-0 border-l overflow-y-auto bg-secondary/30">
          <CspFindingsList findings={report.findings} />
        </aside>
      )}
    </div>
  );
}

function RawBody({ raw }: { raw: unknown }) {
  const text = useMemo(() => fmt(raw), [raw]);
  return (
    <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all overflow-auto h-full text-foreground select-text bg-background">
      {text}
    </pre>
  );
}

function fmt(v: unknown): string {
  if (v === undefined) return "(no value)";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
