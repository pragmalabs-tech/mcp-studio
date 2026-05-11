/**
 * State-driven test result viewer. Renders a recorded Trace + replay
 * Trace + Verdict into a single dialog. Each step shows its action and
 * any drifts that landed at its index. A persistent right pane mounts
 * the widget that was active at the selected step so the reviewer can
 * see the real widget render alongside the action log.
 *
 * Smoke-tested via `pnpm dev`; no RTL tests in this codebase.
 */

import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  XCircle,
  XIcon,
} from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Action, Drift, State, Step, Trace, Verdict } from "../types";
import { analyze } from "@/lib/core/csp/analyze";
import { extractCspDomains } from "@/lib/core/csp/profiles";
import type { MockData } from "@/lib/studio/mock-openai";
import { ContentDialog } from "./content-dialog";
import { CspFindingsList } from "./csp-findings";
import { TracePlayer, type PlayerSpeed } from "./trace-player";
import { WidgetFrame } from "./widget-frame";

interface Props {
  recorded: Trace | null;
  replayed: Trace | null;
  verdict: Verdict | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function TraceModal({
  recorded,
  replayed,
  verdict,
  open,
  onOpenChange,
}: Props) {
  if (!recorded || !replayed || !verdict) return null;

  const driftsByStep = groupDriftsByStep(verdict.drifts);
  const finalState = replayed.steps.at(-1)?.stateAfter ?? replayed.initialState;

  // Default the selected step to the last step so the widget pane shows
  // the trace's final state on open.
  const [selectedIdx, setSelectedIdx] = useState(
    Math.max(0, replayed.steps.length - 1),
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlayerSpeed>(1);
  // Reset selection + playback whenever the dialog (re)opens against a
  // new trace.
  useEffect(() => {
    if (open) {
      setSelectedIdx(Math.max(0, replayed.steps.length - 1));
      setIsPlaying(false);
    }
  }, [open, replayed]);

  // Auto-advance loop. Each step lingers long enough for a viewer to
  // read it; steps with drifts hold a touch longer so the failure is
  // visible. Stops at the last step and flips playback off so the
  // play button re-arms cleanly.
  useEffect(() => {
    if (!isPlaying) return;
    if (selectedIdx >= replayed.steps.length - 1) {
      setIsPlaying(false);
      return;
    }
    const base = 1200 / speed;
    const failed = (driftsByStep.get(selectedIdx) ?? []).length > 0;
    const delay = failed ? base * 1.6 : base;
    const t = setTimeout(() => setSelectedIdx((i) => i + 1), delay);
    return () => clearTimeout(t);
  }, [isPlaying, selectedIdx, speed, replayed.steps.length, driftsByStep]);

  const stepCount = replayed.steps.length;

  // Restart from the beginning if the user hits play after the trace
  // has already ended.
  const handlePlayPauseToggle = () => {
    if (!isPlaying && selectedIdx >= stepCount - 1) {
      setSelectedIdx(0);
    }
    setIsPlaying((p) => !p);
  };

  // Manual selection (clicking a step row or scrubber tick) pauses
  // playback so the viewer can inspect that step.
  const selectStep = (idx: number) => {
    setSelectedIdx(idx);
    setIsPlaying(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className="fixed top-[2vh] left-1/2 -translate-x-1/2 z-50 h-[96vh] w-[96vw] bg-popover text-sm border rounded-lg shadow-2xl flex flex-col"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <DialogPrimitive.Title className="text-sm font-medium">
              {recorded.name} - {verdict.ok ? "PASS" : "FAIL"}{" "}
              <span className="text-xs text-muted-foreground">
                ({verdict.drifts.length} drifts)
              </span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          </header>

          <TracePlayer
            steps={replayed.steps}
            driftsByStep={driftsByStep}
            selectedIdx={selectedIdx}
            onSelect={selectStep}
            isPlaying={isPlaying}
            onPlayPauseToggle={handlePlayPauseToggle}
            speed={speed}
            onSpeedChange={setSpeed}
          />

          <div className="flex-1 min-h-0 flex">
            <div className="w-[480px] shrink-0 flex flex-col border-r">
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {replayed.steps.map((step, i) => (
                  <StepRow
                    key={i}
                    index={i}
                    step={step}
                    allSteps={replayed.steps}
                    drifts={driftsByStep.get(i) ?? []}
                    isSelected={i === selectedIdx}
                    onSelect={() => selectStep(i)}
                  />
                ))}
                {replayed.steps.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    no steps captured
                  </p>
                )}
              </div>
              <footer className="border-t px-4 py-3 shrink-0">
                <Scoreboard state={finalState} />
              </footer>
            </div>

            <WidgetPane steps={replayed.steps} selectedIdx={selectedIdx} />
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

function StepRow({
  index,
  step,
  allSteps,
  drifts,
  isSelected,
  onSelect,
}: {
  index: number;
  step: Step;
  allSteps: readonly Step[];
  drifts: Drift[];
  isSelected: boolean;
  onSelect(): void;
}) {
  const ok = drifts.length === 0;
  const [open, setOpen] = useState(!ok);
  const [viewOpen, setViewOpen] = useState(false);

  const viewable = useMemo(
    () => buildViewable(step.action, allSteps, index),
    [step.action, allSteps, index],
  );

  return (
    <div
      className={`text-xs font-mono border-b border-border/30 rounded-sm ${
        isSelected ? "bg-primary/10 ring-1 ring-primary/30" : ""
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            onSelect();
            setOpen((v) => !v);
          }}
          className="flex-1 text-left py-1.5 px-1 flex items-center gap-2 hover:bg-muted/30 cursor-pointer"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          )}
          {ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          )}
          <span className="text-muted-foreground/60 w-8 text-right">
            {index + 1}
          </span>
          <span className="w-32 truncate text-[10px] uppercase tracking-wider">
            {actionLabel(step.action)}
          </span>
          <span className="truncate flex-1 text-left">
            {actionSummary(step.action)}
          </span>
        </button>
        {viewable && (
          <button
            type="button"
            onClick={() => setViewOpen(true)}
            className="px-1.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded shrink-0 flex items-center gap-1"
            title="View content"
          >
            <Eye className="h-3 w-3" />
            view
          </button>
        )}
      </div>
      {open && (
        <div className="ml-12 mr-1 pb-2 space-y-2">
          {drifts.length > 0 && (
            <div className="space-y-1.5">
              {drifts.map((d, j) => (
                <DriftBlock key={j} drift={d} />
              ))}
            </div>
          )}
          <ActionDetails action={step.action} />
        </div>
      )}
      {viewable && (
        <ContentDialog
          open={viewOpen}
          onOpenChange={setViewOpen}
          title={viewable.title}
          widget={viewable.widget}
          raw={viewable.raw}
        />
      )}
    </div>
  );
}

/**
 * Renders the widget that was active at `selectedIdx`. Walks backward to
 * find the most recent `widget.opened`, then resolves its HTML from a
 * preceding `resources/read` response. The pane re-renders the widget
 * from scratch on each step selection so the iframe state mirrors that
 * point in the trace.
 */
function WidgetPane({
  steps,
  selectedIdx,
}: {
  steps: readonly Step[];
  selectedIdx: number;
}) {
  const activeWidget = useMemo(
    () => findActiveWidget(steps, selectedIdx),
    [steps, selectedIdx],
  );
  const jsonView = useMemo(
    () => (activeWidget ? null : buildJsonView(steps, selectedIdx)),
    [activeWidget, steps, selectedIdx],
  );

  if (activeWidget) {
    return (
      <div className="flex-1 min-w-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-4 py-2 border-b text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 truncate">
            {activeWidget.uri}
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-background">
            <WidgetFrame
              key={`${selectedIdx}-${activeWidget.uri}`}
              html={activeWidget.html}
              mock={activeWidget.mock}
              platform="openai"
              strict={false}
              className="border-none block w-full"
              style={{ minHeight: "100%", width: "100%" }}
            />
          </div>
        </div>
        <aside className="w-72 shrink-0 border-l overflow-y-auto bg-secondary/30">
          <CspFindingsList findings={activeWidget.findings} />
        </aside>
      </div>
    );
  }

  if (jsonView) {
    return (
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-4 py-2 border-b text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 truncate flex items-center gap-2">
          <span>{jsonView.label}</span>
          {jsonView.subtitle && (
            <span className="text-muted-foreground/60 normal-case tracking-normal">
              {jsonView.subtitle}
            </span>
          )}
        </div>
        <pre className="flex-1 min-h-0 overflow-auto p-4 text-xs font-mono whitespace-pre-wrap break-all bg-background text-foreground select-text">
          {jsonView.body}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-xs font-mono text-muted-foreground italic">
        Nothing to show for this step.
      </div>
    </div>
  );
}

interface JsonView {
  label: string;
  subtitle?: string;
  body: string;
}

/** Build the JSON-output panel for a step that isn't a widget render.
 *  Prefers structured tool results (parsed from `content[0].text` when
 *  possible), then raw response/request payloads, with sensible labels. */
function buildJsonView(
  steps: readonly Step[],
  selectedIdx: number,
): JsonView | null {
  const step = steps[Math.min(selectedIdx, steps.length - 1)];
  if (!step) return null;
  const a = step.action;

  if (a.driver === "mcp" && a.kind === "response") {
    const result = a.payload.result;
    const parsed = parseToolResult(result);
    if (parsed !== undefined) {
      return {
        label: a.payload.tool ? `tools/call ${a.payload.tool}` : "mcp.response",
        subtitle: `${a.payload.durationMs.toFixed(1)}ms`,
        body: prettify(parsed),
      };
    }
    if (a.payload.error) {
      return {
        label: "mcp.response (error)",
        subtitle: `${a.payload.durationMs.toFixed(1)}ms`,
        body: prettify(a.payload.error),
      };
    }
    return {
      label: "mcp.response",
      subtitle: `${a.payload.durationMs.toFixed(1)}ms`,
      body: prettify(result ?? null),
    };
  }

  if (a.driver === "mcp" && a.kind === "request") {
    return {
      label: a.payload.method,
      subtitle: `id ${a.payload.id} · ${a.source}`,
      body: prettify(a.payload.params ?? {}),
    };
  }

  if (a.driver === "studio") {
    return {
      label: `${a.driver}.${a.kind}`,
      body: prettify(a.payload),
    };
  }

  if (a.driver === "widget") {
    return {
      label: `${a.driver}.${a.kind}`,
      body: prettify(a.payload),
    };
  }

  return null;
}

/** Tool results land as `{ structuredContent }` or `{ content: [{ text }] }`.
 *  Lift whichever shape is present, parsing JSON text when possible. */
function parseToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { structuredContent?: unknown; content?: unknown };
  if (r.structuredContent !== undefined) return r.structuredContent;
  if (Array.isArray(r.content)) {
    const first = r.content[0] as { text?: unknown } | undefined;
    if (typeof first?.text === "string") {
      try {
        return JSON.parse(first.text);
      } catch {
        return first.text;
      }
    }
  }
  return undefined;
}

function prettify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

interface ActiveWidget {
  uri: string;
  html: string;
  mock: MockData;
  findings: ReturnType<typeof analyze>["findings"];
}

function findActiveWidget(
  steps: readonly Step[],
  selectedIdx: number,
): ActiveWidget | null {
  const upper = Math.min(selectedIdx, steps.length - 1);

  // Walk back from the selected step to find the latest MCP response that
  // carried widget HTML directly inside its result. We read the URI out of
  // `result.contents[i].uri` rather than pairing with a request, because the
  // recorder's `id` counter and the stored `requestId` don't always line up
  // (traces recorded across separate sessions / id reuse).
  let html: string | null = null;
  let uri: string | null = null;
  let meta: Record<string, unknown> = {};
  for (let i = upper; i >= 0; i--) {
    const a = steps[i].action;
    if (a.driver === "widget" && a.kind === "opened") {
      const found = findWidgetHtml(steps, a.payload.uri, i + 1);
      if (found) {
        html = found;
        uri = a.payload.uri;
        break;
      }
    }
    if (a.driver === "mcp" && a.kind === "response") {
      const hit = extractWidgetFromResponse(a.payload.result);
      if (hit) {
        html = hit.html;
        uri = hit.uri;
        meta = hit.meta;
        break;
      }
    }
  }
  if (!html || !uri) return null;

  // Lift the latest tools/call result as `toolOutput` so the widget can
  // render with real data instead of an empty payload.
  const toolOutput = findLatestToolOutput(steps, upper);

  const studio = steps[upper]?.stateAfter.studio;
  const mock: MockData = {
    toolInput: {},
    toolOutput,
    _meta: meta,
    widgetState: null,
    theme: studio?.theme ?? "dark",
    locale: studio?.locale ?? "en-US",
    displayMode: studio?.displayMode ?? "inline",
  };
  const { findings } = analyze(html, extractCspDomains(mock._meta));
  return { uri, html, mock, findings };
}

/** Return the first HTML-looking content entry from a `resources/read`
 *  result, along with its declared URI and any `_meta` block (MCP Apps
 *  spec puts CSP domains on the content entry itself). */
function extractWidgetFromResponse(
  result: unknown,
): { uri: string; html: string; meta: Record<string, unknown> } | null {
  const contents = (result as { contents?: unknown } | null)?.contents;
  if (!Array.isArray(contents)) return null;
  for (const c of contents) {
    if (!c || typeof c !== "object") continue;
    const entry = c as { uri?: unknown; text?: unknown; _meta?: unknown };
    const text = typeof entry.text === "string" ? entry.text : null;
    if (!text) continue;
    const u = typeof entry.uri === "string" ? entry.uri : null;
    if ((u && u.startsWith("ui://")) || looksLikeHtml(text)) {
      const m =
        entry._meta && typeof entry._meta === "object"
          ? (entry._meta as Record<string, unknown>)
          : {};
      return { uri: u ?? "(html)", html: text, meta: m };
    }
  }
  return null;
}

/** Pull the most recent `tools/call` result text payload (parsed as JSON
 *  when possible) so the replay widget can render with the same data the
 *  user saw at record time. */
function findLatestToolOutput(steps: readonly Step[], upper: number): unknown {
  for (let i = upper; i >= 0; i--) {
    const a = steps[i].action;
    if (a.driver !== "mcp" || a.kind !== "response") continue;
    const result = a.payload.result as {
      content?: unknown;
      structuredContent?: unknown;
    } | null;
    if (!result) continue;
    if (result.structuredContent !== undefined) return result.structuredContent;
    const content = Array.isArray(result.content) ? result.content : null;
    if (!content) continue;
    const first = content[0] as { text?: unknown } | undefined;
    if (typeof first?.text !== "string") continue;
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }
  return {};
}

function looksLikeHtml(s: string): boolean {
  return /<html|<!doctype|<body|<head/i.test(s.slice(0, 2000));
}

interface Viewable {
  title: string;
  widget?: { html: string };
  raw?: unknown;
}

const LARGE_PAYLOAD_THRESHOLD = 200;

function buildViewable(
  action: Action,
  steps: readonly Step[],
  index: number,
): Viewable | null {
  if (action.driver === "widget" && action.kind === "opened") {
    const html = findWidgetHtml(steps, action.payload.uri, index);
    if (html) {
      return { title: action.payload.uri, widget: { html } };
    }
    return { title: action.payload.uri, raw: action.payload.data };
  }
  const json = safeStringify(action.payload);
  if (json.length > LARGE_PAYLOAD_THRESHOLD) {
    return { title: `${action.driver}.${action.kind}`, raw: action.payload };
  }
  return null;
}

/** Walk steps before `beforeIdx` and resolve the most recent
 *  `resources/read` response whose request URI matches. */
function findWidgetHtml(
  steps: readonly Step[],
  uri: string,
  beforeIdx: number,
): string | null {
  const pending = new Set<number>();
  let lastHtml: string | null = null;
  for (let i = 0; i < beforeIdx; i++) {
    const a = steps[i].action;
    if (a.driver !== "mcp") continue;
    if (a.kind === "request") {
      const params = a.payload.params as { uri?: string } | null;
      if (a.payload.method === "resources/read" && params?.uri === uri) {
        pending.add(a.payload.id);
      }
    } else if (a.kind === "response" && pending.has(a.payload.requestId)) {
      pending.delete(a.payload.requestId);
      const text = (
        a.payload.result as { contents?: { text?: string }[] } | null
      )?.contents?.[0]?.text;
      if (typeof text === "string") lastHtml = text;
    }
  }
  return lastHtml;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function DriftBlock({ drift }: { drift: Drift }) {
  return (
    <div className="text-[10px] font-mono border-l-2 border-red-400/40 pl-2 py-1 bg-red-500/5 rounded-sm">
      <div className="text-red-400">
        <span className="opacity-60">{drift.reason}</span>{" "}
        <span className="font-semibold">{drift.path || "(step)"}</span>
      </div>
      <div className="mt-0.5 text-muted-foreground">
        <span className="opacity-60 w-16 inline-block">expected:</span>{" "}
        <span className="text-foreground/80 whitespace-pre-wrap break-all">
          {fmt(drift.expected)}
        </span>
      </div>
      <div className="text-muted-foreground">
        <span className="opacity-60 w-16 inline-block">got:</span>{" "}
        <span className="text-foreground/80 whitespace-pre-wrap break-all">
          {fmt(drift.actual)}
        </span>
      </div>
    </div>
  );
}

function ActionDetails({ action }: { action: Action }) {
  return (
    <div className="text-[10px] font-mono">
      <div className="text-muted-foreground/60 uppercase tracking-wider mb-0.5">
        action payload
      </div>
      <pre className="text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 p-2 rounded max-h-64 overflow-auto">
        {JSON.stringify(action.payload, null, 2)}
      </pre>
    </div>
  );
}

function Scoreboard({ state }: { state: State }) {
  const tools = Object.entries(state.tools);
  return (
    <div className="text-[10px] font-mono space-y-0.5">
      <div className="text-muted-foreground uppercase tracking-wider">
        scoreboard
      </div>
      <div>
        network: {state.network.requestCount} req ·{" "}
        {state.network.responseCount} resp · {state.network.errorCount} err
      </div>
      <div>
        widgets: {state.widgets.renderCount} render ·{" "}
        {state.widgets.open.length} open
      </div>
      {tools.length > 0 && (
        <div>
          tools: {tools.map(([name, t]) => `${name}:${t.callCount}`).join(", ")}
        </div>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function groupDriftsByStep(drifts: readonly Drift[]): Map<number, Drift[]> {
  const out = new Map<number, Drift[]>();
  for (const d of drifts) {
    const arr = out.get(d.stepIndex);
    if (arr) arr.push(d);
    else out.set(d.stepIndex, [d]);
  }
  return out;
}

function actionLabel(a: Action): string {
  return `${a.driver}.${a.kind}`;
}

function actionSummary(a: Action): string {
  if (a.driver === "studio" && a.kind === "select") {
    return a.payload.selection?.name ?? "(cleared)";
  }
  if (a.driver === "mcp" && a.kind === "request") {
    const name = (a.payload.params as { name?: unknown } | null)?.name;
    return typeof name === "string"
      ? `${a.payload.method} ${name}`
      : a.payload.method;
  }
  if (a.driver === "mcp" && a.kind === "response") {
    return a.payload.error ? `error: ${a.payload.error.message}` : "ok";
  }
  if (a.driver === "widget" && a.kind === "opened") {
    return a.payload.uri;
  }
  if (a.driver === "widget" && a.kind.startsWith("dom.")) {
    const sel = (
      a.payload as {
        selectors?: { testid?: string; aria?: { label?: string } };
      }
    ).selectors;
    return sel?.testid ?? sel?.aria?.label ?? "(selector)";
  }
  return "";
}

function fmt(v: unknown): string {
  if (v === undefined) return "-";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
