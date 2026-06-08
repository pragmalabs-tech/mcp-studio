import { useState } from "react";
import { Maximize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { WidgetSnapshot } from "./snapshot";

export function SnapshotIframeViewer({
  srcDoc,
  title,
  className,
}: {
  srcDoc: string;
  title: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div
        className={cn(
          "relative group rounded border bg-background overflow-hidden",
          className,
        )}
      >
        <iframe
          srcDoc={srcDoc}
          sandbox=""
          title={`Widget snapshot — ${title}`}
          className="w-full h-full"
        />
        <button
          onClick={() => setExpanded(true)}
          className="absolute top-1.5 right-1.5 p-1 rounded bg-background/80 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          title="Expand snapshot"
        >
          <Maximize2 size={12} />
        </button>
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          style={{
            width: "90vw",
            maxWidth: "90vw",
            height: "90vh",
            display: "flex",
            flexDirection: "column",
            padding: 0,
            gap: 0,
            overflow: "hidden",
          }}
        >
          <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
            <DialogTitle className="text-sm">Snapshot — {title}</DialogTitle>
            <DialogDescription className="sr-only">
              Full-size view of the {title.toLowerCase()} snapshot
            </DialogDescription>
          </DialogHeader>
          <iframe
            srcDoc={srcDoc}
            sandbox=""
            title={`Widget snapshot fullscreen — ${title}`}
            className="w-full border-t bg-background"
            style={{ flex: "1 1 0", minHeight: 0 }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SnapshotViewer({ snapshot }: { snapshot: WidgetSnapshot }) {
  const srcDoc = `<style>html,body{margin:0}</style>${snapshot.html}`;
  return (
    <SnapshotIframeViewer
      srcDoc={srcDoc}
      title={snapshot.id}
      className="w-full h-[800px]"
    />
  );
}
