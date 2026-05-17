/**
 * Small text button that copies a string to the clipboard and shows a
 * 1.5s "Copied" confirmation. Designed for section headers and panels
 * where the user wants to grab content (JSON, HTML, etc.) for debugging.
 *
 * Resolves text lazily so callers can pass a getter for content that
 * changes between renders without recomputing on every parent re-render.
 */

import { useState } from "react";

interface Props {
  /** String to copy, or a function returning the string at click time. */
  value: string | (() => string);
  /** Optional label override - defaults to "Copy" / "Copied". */
  label?: string;
  /** Optional tooltip text. */
  title?: string;
  className?: string;
}

export function CopyButton({ value, label = "Copy", title, className }: Props) {
  const [copied, setCopied] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = typeof value === "function" ? value() : value;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard permissions may be denied in some sandboxes - silent */
      },
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title ?? "Copy to clipboard"}
      className={
        className ??
        "text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded normal-case tracking-normal"
      }
    >
      {copied ? "Copied" : label}
    </button>
  );
}
