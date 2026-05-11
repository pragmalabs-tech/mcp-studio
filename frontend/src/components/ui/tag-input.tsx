import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizeTag, normalizeTags } from "@/lib/tests/tags";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: readonly string[];
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Add tag…",
  autoFocus,
  className,
}: Props) {
  const [buffer, setBuffer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const taken = new Set(value);
    const q = buffer.trim().toLowerCase();
    const pool = suggestions.filter((s) => !taken.has(s) && s !== q);
    if (!q) return pool.slice(0, 12);
    return pool.filter((s) => s.includes(q)).slice(0, 12);
  }, [buffer, suggestions, value]);

  function commit(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag) return;
    if (value.includes(tag)) {
      setBuffer("");
      return;
    }
    onChange(normalizeTags([...value, tag]));
    setBuffer("");
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      e.stopPropagation();
      commit(buffer);
      return;
    }
    if (e.key === "Backspace" && buffer.length === 0 && value.length > 0) {
      e.preventDefault();
      remove(value[value.length - 1]);
      return;
    }
    if (e.key === "Tab" && buffer.trim().length > 0) {
      e.preventDefault();
      commit(buffer);
    }
  }

  function handleBlur() {
    if (buffer.trim().length > 0) commit(buffer);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className="flex flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 min-h-8 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 transition-colors cursor-text dark:bg-input/30"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="text-[10px] px-1.5 py-0 gap-0.5"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(tag);
              }}
              className="ml-0.5 -mr-0.5 hover:text-foreground text-muted-foreground"
              aria-label={`Remove ${tag}`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
        <Input
          ref={inputRef}
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ""}
          autoFocus={autoFocus}
          className="flex-1 h-6 min-w-[80px] border-0 bg-transparent px-1 text-sm focus-visible:ring-0 dark:bg-transparent"
        />
      </div>
      {matches.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground font-medium">
            {buffer.trim().length > 0 ? "Matches" : "Existing tags"}
          </div>
          <div className="flex flex-wrap gap-1">
            {matches.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => commit(s)}
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
