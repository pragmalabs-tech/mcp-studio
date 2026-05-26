import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  tags: readonly string[];
  selected: readonly string[];
  onSelectionChange: (next: string[]) => void;
  className?: string;
}

export function TagFilter({
  tags,
  selected,
  onSelectionChange,
  className,
}: Props) {
  if (tags.length === 0) return null;

  const selectedSet = new Set(selected);

  function toggle(tag: string) {
    if (selectedSet.has(tag)) {
      onSelectionChange(selected.filter((t) => t !== tag));
    } else {
      onSelectionChange([...selected, tag]);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tags.map((tag) => {
        const active = selectedSet.has(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={cn(
              "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tag}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onSelectionChange([])}
          className="text-[11px] flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear tag filter"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
