/**
 * Forwarded `console.*` output from the live widget iframe. Read-only -
 * intended as a debug surface, never used for replay assertions.
 *
 * Mirrors the layout of ActionLog (header bar with Clear, scrolling rows,
 * hover-to-Copy) so the two tabs feel like one panel with two filters.
 */

import { useEffect, useRef, useState } from "react";
import {
  useWidgetStore,
  type ConsoleEntry,
  type ConsoleLevel,
} from "@/lib/studio/stores/widget-store";
import { Button } from "@/components/ui/button";

const LEVEL_CLASS: Record<ConsoleLevel, string> = {
  log: "text-foreground",
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  debug: "text-muted-foreground",
};

const LEVEL_LABEL: Record<ConsoleLevel, string> = {
  log: "log",
  info: "info",
  warn: "warn",
  error: "error",
  debug: "debug",
};

function ConsoleRow({ entry, index }: { entry: ConsoleEntry; index: number }) {
  const [copied, setCopied] = useState(false);
  const text = entry.args.join(" ");

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${entry.time} [${entry.level}] ${text}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      key={index}
      className="px-3 py-1 text-xs font-mono border-b border-border/30 group"
    >
      <div className="flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <span className="text-muted-foreground mr-2">{entry.time}</span>
          <span
            className={`font-semibold mr-2 ${LEVEL_CLASS[entry.level]}`}
            title={`console.${entry.level}`}
          >
            [{LEVEL_LABEL[entry.level]}]
          </span>
          <span className="text-foreground/90 break-all whitespace-pre-wrap">
            {text}
          </span>
        </div>
        <button
          onClick={copy}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground text-xs px-1.5 py-0.5 rounded hover:bg-secondary transition-opacity"
          title="Copy log entry"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function ConsoleLog() {
  const { consoleEntries, clearConsoleEntries } = useWidgetStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [consoleEntries]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Widget Console
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={clearConsoleEntries}
        >
          Clear
        </Button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        {consoleEntries.length === 0 ? (
          <p className="text-center text-muted-foreground text-xs py-6">
            No console output yet. `console.log` calls from the widget appear
            here.
          </p>
        ) : (
          <div className="py-1">
            {consoleEntries.map((c, i) => (
              <ConsoleRow key={i} entry={c} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
