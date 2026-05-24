import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonViewProps {
  /** Value to render as a collapsible tree. Strings are shown verbatim. */
  value: unknown;
  /** Optional baseline; nodes that differ from it are highlighted as a diff. */
  diffAgainst?: unknown;
  /** Initial depth that auto-expands. Deeper nodes start collapsed. */
  initialDepth?: number;
  className?: string;
  /** Hide the copy button (read-only contexts). */
  hideCopy?: boolean;
}

/**
 * Collapsible, colored JSON viewer. Provides:
 *   - Syntax colors per value type (string / number / boolean / null / key).
 *   - Click-to-collapse on objects and arrays (shrinks "the entire response"
 *     down to a one-liner so the dialog isn't a wall of JSON).
 *   - `diffAgainst` highlights values that don't match the baseline at the
 *     same path — additions (red) and removals (amber). Used by the replay
 *     dialog's Expected vs Actual columns.
 *
 * Drop-in replacement for the old `<pre>`-based JsonView; same outer API
 * (`value`, `className`, `hideCopy`) so existing call sites keep working.
 */
export function JsonView({
  value,
  diffAgainst,
  initialDepth = 2,
  className,
  hideCopy = false,
}: JsonViewProps) {
  const text = useMemo(
    () => (typeof value === "string" ? value : JSON.stringify(value, null, 2)),
    [value],
  );

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
        <div className="font-mono text-[11px] p-2 pr-9 leading-relaxed">
          {typeof value === "string" ? (
            <span className="text-foreground whitespace-pre-wrap break-words">
              {value}
            </span>
          ) : (
            <Node
              value={value}
              baseline={diffAgainst}
              hasBaseline={diffAgainst !== undefined}
              depth={0}
              initialDepth={initialDepth}
              keyName={null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tree renderer ──

interface NodeProps {
  value: unknown;
  /** Baseline value at this path; used for diff highlighting. */
  baseline: unknown;
  /** True when diff highlighting is in play; false skips comparison. */
  hasBaseline: boolean;
  depth: number;
  initialDepth: number;
  /** Object key or array index name, if this node is inside a parent. */
  keyName: string | number | null;
}

function Node({
  value,
  baseline,
  hasBaseline,
  depth,
  initialDepth,
  keyName,
}: NodeProps) {
  if (Array.isArray(value)) {
    return (
      <CollapsibleNode
        keyName={keyName}
        depth={depth}
        initialDepth={initialDepth}
        open={"["}
        close={"]"}
        count={value.length}
        diffStatus={diffStatus(value, baseline, hasBaseline)}
      >
        {(expanded) =>
          expanded
            ? value.map((item, i) => (
                <Node
                  key={i}
                  value={item}
                  baseline={Array.isArray(baseline) ? baseline[i] : undefined}
                  hasBaseline={hasBaseline}
                  depth={depth + 1}
                  initialDepth={initialDepth}
                  keyName={i}
                />
              ))
            : null
        }
      </CollapsibleNode>
    );
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    return (
      <CollapsibleNode
        keyName={keyName}
        depth={depth}
        initialDepth={initialDepth}
        open={"{"}
        close={"}"}
        count={keys.length}
        diffStatus={diffStatus(value, baseline, hasBaseline)}
      >
        {(expanded) =>
          expanded
            ? keys.map((k) => (
                <Node
                  key={k}
                  value={obj[k]}
                  baseline={
                    baseline && typeof baseline === "object"
                      ? (baseline as Record<string, unknown>)[k]
                      : undefined
                  }
                  hasBaseline={hasBaseline}
                  depth={depth + 1}
                  initialDepth={initialDepth}
                  keyName={k}
                />
              ))
            : null
        }
      </CollapsibleNode>
    );
  }

  // Leaf
  return (
    <LeafRow
      keyName={keyName}
      depth={depth}
      diffStatus={diffStatus(value, baseline, hasBaseline)}
    >
      <Primitive value={value} />
    </LeafRow>
  );
}

// ── Collapsible block (object or array) ──

interface CollapsibleNodeProps {
  keyName: string | number | null;
  depth: number;
  initialDepth: number;
  open: string;
  close: string;
  count: number;
  diffStatus: DiffStatus;
  children: (expanded: boolean) => React.ReactNode;
}

function CollapsibleNode({
  keyName,
  depth,
  initialDepth,
  open,
  close,
  count,
  diffStatus,
  children,
}: CollapsibleNodeProps) {
  const [expanded, setExpanded] = useState(depth < initialDepth);

  return (
    <div
      className={cn(
        "rounded",
        diffStatus === "changed" && "bg-destructive/10",
        diffStatus === "missing" && "bg-warning/10",
      )}
    >
      <div
        className="flex items-start gap-1 cursor-pointer hover:bg-accent/40 rounded"
        onClick={() => setExpanded((v) => !v)}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
        )}
        {keyName !== null && (
          <>
            <KeyLabel name={keyName} />
            <span className="text-muted-foreground">:</span>
          </>
        )}
        <span className="text-muted-foreground">{open}</span>
        {!expanded && (
          <>
            <span className="text-muted-foreground italic">
              {count} {count === 1 ? "item" : "items"}
            </span>
            <span className="text-muted-foreground">{close}</span>
          </>
        )}
      </div>
      {expanded && (
        <>
          <div>{children(true)}</div>
          <div
            className="text-muted-foreground"
            style={{ paddingLeft: `${depth * 12 + 16}px` }}
          >
            {close}
          </div>
        </>
      )}
    </div>
  );
}

// ── Leaf row ──

function LeafRow({
  keyName,
  depth,
  diffStatus,
  children,
}: {
  keyName: string | number | null;
  depth: number;
  diffStatus: DiffStatus;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded",
        diffStatus === "changed" && "bg-destructive/10",
        diffStatus === "missing" && "bg-warning/10",
      )}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
    >
      {keyName !== null && (
        <>
          <KeyLabel name={keyName} />
          <span className="text-muted-foreground">:</span>
        </>
      )}
      {children}
    </div>
  );
}

function KeyLabel({ name }: { name: string | number }) {
  if (typeof name === "number") {
    return <span className="text-muted-foreground">[{name}]</span>;
  }
  return <span className="text-primary">{name}</span>;
}

// ── Primitive renderer with type colors ──

/** Threshold above which a string leaf is truncated. Picked so error
 *  messages, URIs, and short snippets render in full while multi-KB
 *  blobs (e.g. a widget HTML snapshot) collapse to a glimpse. The full
 *  text is still reachable via the top-of-tree copy button. */
const STRING_PREVIEW_CHARS = 200;

function Primitive({ value }: { value: unknown }) {
  if (value === null)
    return <span className="text-muted-foreground">null</span>;
  if (value === undefined)
    return <span className="text-muted-foreground italic">undefined</span>;
  if (typeof value === "string") {
    if (value.length > STRING_PREVIEW_CHARS) {
      const hidden = value.length - STRING_PREVIEW_CHARS;
      return (
        <span
          className="text-success break-all"
          title={`${value.length} chars — use the copy button to grab the full value`}
        >
          "{value.slice(0, STRING_PREVIEW_CHARS)}…"
          <span className="text-muted-foreground italic ml-1">
            (+{hidden.toLocaleString()} chars)
          </span>
        </span>
      );
    }
    return <span className="text-success break-all">"{value}"</span>;
  }
  if (typeof value === "number") {
    return <span className="text-warning">{value}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-warning">{value ? "true" : "false"}</span>;
  }
  return <span className="text-foreground">{String(value)}</span>;
}

// ── Diff classification ──

type DiffStatus = "same" | "changed" | "missing";

/**
 * Classify a node against its baseline. `missing` means the value is
 * present here but absent on the other side; `changed` means anything in
 * the subtree differs (so containers light up even when their direct
 * children look fine — the user can drill down to find the actual diff).
 */
function diffStatus(
  value: unknown,
  baseline: unknown,
  hasBaseline: boolean,
): DiffStatus {
  if (!hasBaseline) return "same";
  if (baseline === undefined && value !== undefined) return "missing";
  if (value === undefined && baseline !== undefined) return "missing";
  if (!deepEqual(value, baseline)) return "changed";
  return "same";
}

/** Recursive structural compare. Used to bubble the "changed" marker up
 *  to containers so a collapsed `lastResult: { 2 items }` lights up when
 *  any descendant value differs between Expected and Actual. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in bo)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

// ── Copy button ──

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
