import { useEffect, useRef, useState } from "react";
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
  bounds,
  className,
}: {
  srcDoc: string;
  title: string;
  bounds?: { width: number; height: number };
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    if (!bounds || !containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setScale(Math.min(width / bounds.width, height / bounds.height));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [bounds]);

  const dialogWidth = bounds ? `min(${bounds.width}px, 95vw)` : "90vw";
  const dialogHeight = bounds ? `min(${bounds.height + 56}px, 90vh)` : "90vh";

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "relative group rounded border bg-background overflow-hidden",
          className,
        )}
      >
        {bounds && scale !== null ? (
          <iframe
            srcDoc={srcDoc}
            sandbox=""
            title={`Widget snapshot — ${title}`}
            style={{
              width: bounds.width,
              height: bounds.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              display: "block",
              flexShrink: 0,
            }}
          />
        ) : (
          <iframe
            srcDoc={srcDoc}
            sandbox=""
            title={`Widget snapshot — ${title}`}
            className="w-full h-full"
          />
        )}
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
            width: dialogWidth,
            maxWidth: "95vw",
            height: dialogHeight,
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
      bounds={snapshot.bounds}
      className="w-full h-[800px]"
    />
  );
}
