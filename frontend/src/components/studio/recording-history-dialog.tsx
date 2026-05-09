import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon, Download } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { recorder } from "@/lib/recorder/bus";
import { downloadSession } from "@/lib/recorder/export";
import type { Recorded } from "@/lib/recorder/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const KIND_COLOR: Record<string, string> = {
  "sidebar.select": "text-sky-400",
  "editor.set_args": "text-amber-400",
  "config.update": "text-violet-400",
  "auth.update": "text-violet-400",
  "mcp.request": "text-emerald-400",
  "mcp.response": "text-emerald-300",
  "mcp.notification": "text-emerald-200",
  "widget.render": "text-fuchsia-400",
  "widget.mock.set": "text-fuchsia-300",
  "widget.intent": "text-pink-400",
  "widget.dom.click": "text-orange-400",
  "widget.dom.input": "text-orange-300",
  "widget.dom.change": "text-orange-300",
  "widget.dom.submit": "text-orange-400",
  "widget.dom.keydown": "text-yellow-400",
  "csp.violation": "text-red-400",
};

function formatRelMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0).padStart(4, " ")}ms`;
  return `${(ms / 1000).toFixed(2).padStart(6, " ")}s`;
}

function summarize(entry: Recorded): string {
  switch (entry.kind) {
    case "sidebar.select":
      return `${entry.selection.type}:${entry.selection.name}`;
    case "config.update":
      return Object.keys(entry.patch).join(", ");
    case "auth.update":
      return entry.patch.method ?? "(token)";
    case "mcp.request":
      return `${entry.method} (${entry.source}) #${entry.id}`;
    case "mcp.response":
      return entry.error
        ? `#${entry.requestId} error: ${entry.error.message}`
        : `#${entry.requestId} ok (${entry.durationMs.toFixed(0)}ms)`;
    case "mcp.notification":
      return entry.method;
    case "widget.render":
      return `${entry.name} (${entry.htmlHash})`;
    case "widget.intent":
      return entry.name;
    case "widget.dom.click":
    case "widget.dom.submit":
      return selectorBrief(entry.selectors);
    case "widget.dom.input":
    case "widget.dom.change":
      return `${selectorBrief(entry.selectors)} = ${JSON.stringify(entry.value)}`;
    case "widget.dom.keydown":
      return `${selectorBrief(entry.selectors)} ${entry.key}${
        entry.mods ? ` mods=${entry.mods}` : ""
      }`;
    case "csp.violation":
      return `${entry.directive} ← ${entry.blockedUri}`;
    default:
      return "";
  }
}

function selectorBrief(s: {
  testid?: string;
  aria?: { label?: string };
  text?: { tag: string; value: string };
  css?: string;
}): string {
  if (s.testid) return `[testid=${s.testid}]`;
  if (s.aria?.label) return `[aria=${s.aria.label}]`;
  if (s.text) return `${s.text.tag}:"${s.text.value}"`;
  if (s.css) return s.css;
  return "(unresolved)";
}

function HistoryRow({ entry, index }: { entry: Recorded; index: number }) {
  const [open, setOpen] = useState(false);
  const color = KIND_COLOR[entry.kind] ?? "text-muted-foreground";
  const summary = summarize(entry);
  return (
    <div
      className="px-3 py-1 text-xs font-mono border-b border-border/30 hover:bg-secondary/30 cursor-pointer"
      onClick={() => setOpen((v) => !v)}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground/60 w-12 shrink-0 text-right">
          {index + 1}
        </span>
        <span className="text-muted-foreground w-16 shrink-0 text-right">
          {formatRelMs(entry.relMs)}
        </span>
        <span className={`${color} w-40 shrink-0 font-semibold`}>
          {entry.kind}
        </span>
        <span className="text-muted-foreground truncate flex-1">{summary}</span>
        <span className="text-muted-foreground/40 text-[10px] shrink-0">
          {open ? "▼" : "▶"}
        </span>
      </div>
      {open && (
        <pre className="mt-1 ml-[7.5rem] text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
          {JSON.stringify(entry, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function RecordingHistoryDialog({ open, onOpenChange }: Props) {
  const [entries, setEntries] = useState<Recorded[]>(() => recorder.snapshot());

  useEffect(() => {
    if (!open) return;
    setEntries(recorder.snapshot());
    const offEmit = recorder.onEmit((entry) => {
      setEntries((prev) => [...prev, entry]);
    });
    const offMode = recorder.subscribe(() => {
      setEntries(recorder.snapshot());
    });
    return () => {
      offEmit();
      offMode();
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-0 right-0 z-50 h-screen w-[640px] max-w-[95vw] bg-popover text-sm text-popover-foreground border-l shadow-2xl outline-none flex flex-col data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right duration-150"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0 gap-2">
            <DialogPrimitive.Title className="text-sm font-medium flex items-center gap-2 min-w-0">
              <span className="truncate">Action history</span>
              <span className="text-xs font-normal text-muted-foreground shrink-0">
                {entries.length}
              </span>
            </DialogPrimitive.Title>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadSession(recorder.serialize())}
                disabled={entries.length === 0}
                title="Download a session.json snapshot"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
              <DialogPrimitive.Close
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {entries.length === 0 ? (
              <p className="text-center text-muted-foreground text-xs py-12 px-6">
                No actions yet. Interact with Studio (pick a tool, edit args,
                execute, click inside the widget) and entries will appear here.
              </p>
            ) : (
              entries.map((e, i) => <HistoryRow key={i} entry={e} index={i} />)
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
