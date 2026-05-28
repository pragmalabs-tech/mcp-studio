import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ResizableSplitProps {
  top: ReactNode;
  bottom: ReactNode;
  /** Hardcoded default height (px) for the bottom pane. The top pane fills
   *  whatever's left. Pixel-based (not ratio) so the bottom never shrinks
   *  when content in the top pane grows. */
  defaultBottomPx?: number;
  minTopPx?: number;
  minBottomPx?: number;
  /** When set, persists the bottom-pane height (px) in localStorage. */
  storageKey?: string;
}

export function ResizableSplit({
  top,
  bottom,
  defaultBottomPx = 320,
  minTopPx = 100,
  minBottomPx = 120,
  storageKey,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bottomPx, setBottomPx] = useState(() => {
    if (!storageKey) return defaultBottomPx;
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? Number(stored) : NaN;
    // Stored value must be a plausible pixel height. Old ratio values
    // (0 < v < 1) from a previous version are ignored — fall through to
    // the default.
    return Number.isFinite(parsed) && parsed >= minBottomPx
      ? parsed
      : defaultBottomPx;
  });
  const dragging = useRef(false);

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(bottomPx));
  }, [bottomPx, storageKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const newBottom = rect.bottom - e.clientY;
        const clamped = Math.max(
          minBottomPx,
          Math.min(rect.height - minTopPx, newBottom),
        );
        setBottomPx(clamped);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [minTopPx, minBottomPx],
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
    >
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{top}</div>
      <div
        onMouseDown={onMouseDown}
        className="shrink-0 h-1 cursor-row-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
      />
      <div
        className="shrink-0 flex flex-col overflow-hidden"
        style={{ height: bottomPx }}
      >
        {bottom}
      </div>
    </div>
  );
}

interface ResizableHorizontalSplitProps {
  left: ReactNode;
  right: ReactNode;
  defaultRatio?: number;
  minLeftPx?: number;
  minRightPx?: number;
  storageKey?: string;
}

export function ResizableHorizontalSplit({
  left,
  right,
  defaultRatio = 0.5,
  minLeftPx = 320,
  minRightPx = 480,
  storageKey,
}: ResizableHorizontalSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => {
    if (!storageKey) return defaultRatio;
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1
      ? parsed
      : defaultRatio;
  });
  const dragging = useRef(false);

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(ratio));
  }, [ratio, storageKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = "col-resize";

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const total = rect.width;
        const clamped = Math.max(minLeftPx, Math.min(total - minRightPx, x));
        setRatio(clamped / total);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [minLeftPx, minRightPx],
  );

  return (
    <div ref={containerRef} className="flex-1 flex min-w-0 overflow-hidden">
      <div
        className="flex flex-col min-w-0 overflow-hidden"
        style={{ flex: `0 0 ${ratio * 100}%` }}
      >
        {left}
      </div>
      <div
        onMouseDown={onMouseDown}
        className="shrink-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {right}
      </div>
    </div>
  );
}
