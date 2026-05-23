import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonViewProps {
  /** The value to pretty-print. Strings are shown verbatim, everything else
   *  goes through `JSON.stringify(value, null, 2)`. */
  value: unknown;
  /** Indent depth passed to JSON.stringify. Defaults to 2. */
  indent?: number;
  /** Tailwind utilities to override the outer wrapper (sizing, max-height). */
  className?: string;
  /** Override the inner <pre> classes (font size, padding). */
  preClassName?: string;
  /** Hide the copy button (for read-only contexts). */
  hideCopy?: boolean;
}

/**
 * The studio's one-and-only JSON viewer. Renders a scrollable, monospace
 * block with a floating copy button in the top-right. Use this anywhere
 * the studio displays JSON so the look + copy affordance stays consistent.
 *
 * The outer wrapper provides the `min-width: 0` chain (`w-full max-w-full`)
 * that prevents long lines from forcing a parent flex/grid track open —
 * callers can put it inside any flex column without further plumbing.
 */
export function JsonView({
  value,
  indent = 2,
  className,
  preClassName,
  hideCopy = false,
}: JsonViewProps) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, indent);
  return (
    <div
      className={cn(
        "group relative w-full max-w-full rounded bg-muted",
        className,
      )}
    >
      {!hideCopy && (
        <CopyIconButton
          value={text}
          className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        />
      )}
      <div className="w-full max-w-full overflow-auto rounded">
        <pre
          className={cn(
            "font-mono text-[11px] p-2 whitespace-pre",
            !hideCopy && "pr-9",
            preClassName,
          )}
        >
          {text}
        </pre>
      </div>
    </div>
  );
}

function CopyIconButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard denied — silent */
      },
    );
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? "Copied" : "Copy"}
      className={cn(
        "inline-flex items-center justify-center h-6 w-6 rounded bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background",
        className,
      )}
    >
      {copied ? (
        <Check className="h-3 w-3 text-success" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}
