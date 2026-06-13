import { useEffect, useState } from "react";
import { useWidgetStore } from "@/lib/studio/stores/widget-store";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { CONFIG } from "@/lib/config";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  McpResourceAnnotations,
  McpToolAnnotations,
} from "@/lib/studio/api";

type Tab = "args" | "definition" | "testdata";

const DEFAULT_INJECT_JSON = JSON.stringify(
  { toolInput: {}, toolOutput: {} },
  null,
  2,
);

export function RequestEditor() {
  const {
    selected,
    editorValue,
    toolExecuting,
    setEditorValue,
    applyMock,
    injectMockData,
    execute,
  } = useWidgetStore();

  const activeWidgetId = useWidgetStore((s) => s.activeWidgetId);
  const hasWidget = useWidgetStore((s) =>
    activeWidgetId ? !!s.widgets[activeWidgetId] : false,
  );

  const isWidget = selected?.type === "widget";
  const isResourceWithWidget = selected?.type === "resource" && hasWidget;
  const showExecute =
    selected?.type === "tool" || selected?.type === "resource";
  // Definition is only meaningful when the selection is an MCP tool or
  // resource - widget previews use the mock-data editor and have no
  // server-side definition to display.
  const hasDefinition =
    selected?.type === "tool" || selected?.type === "resource";

  const [tab, setTab] = useState<Tab>("args");
  const [injectJson, setInjectJson] = useState(DEFAULT_INJECT_JSON);

  // Reset to the args tab when the selection changes so users don't land
  // on a stale Definition view after switching tools.
  useEffect(() => {
    setTab("args");
  }, [selected]);

  const argsLabel =
    selected?.type === "tool"
      ? "Tool Arguments"
      : selected?.type === "resource"
        ? "Resource Request"
        : "Mock Data";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/50 shrink-0">
        <div className="flex items-center gap-3">
          {hasDefinition ? (
            <>
              <TabButton active={tab === "args"} onClick={() => setTab("args")}>
                {argsLabel}
              </TabButton>
              <TabButton
                active={tab === "definition"}
                onClick={() => setTab("definition")}
              >
                Definition
              </TabButton>
              {isResourceWithWidget && (
                <TabButton
                  active={tab === "testdata"}
                  onClick={() => setTab("testdata")}
                >
                  Test Data
                </TabButton>
              )}
            </>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {argsLabel}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {tab === "args" && (
            <>
              {isWidget && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={applyMock}
                >
                  ▶ Mock
                </Button>
              )}
              {showExecute && (
                <Button
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={execute}
                  disabled={toolExecuting}
                >
                  {toolExecuting ? "…" : "⚡ Execute"}
                </Button>
              )}
            </>
          )}
          {tab === "testdata" && (
            <Button
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => injectMockData(injectJson)}
            >
              ▶ Inject
            </Button>
          )}
        </div>
      </div>

      {tab === "args" ? (
        <CodeMirror
          value={editorValue}
          onChange={setEditorValue}
          extensions={[json(), EditorView.lineWrapping]}
          theme="dark"
          basicSetup={{ lineNumbers: false, foldGutter: false }}
          className="flex-1 min-h-0 overflow-auto text-xs [&_.cm-editor]:h-full [&_.cm-scroller]:h-full [&_.cm-editor.cm-focused]:outline-none"
        />
      ) : tab === "testdata" ? (
        <CodeMirror
          value={injectJson}
          onChange={setInjectJson}
          extensions={[json(), EditorView.lineWrapping]}
          theme="dark"
          basicSetup={{ lineNumbers: false, foldGutter: false }}
          className="flex-1 min-h-0 overflow-auto text-xs [&_.cm-editor]:h-full [&_.cm-scroller]:h-full [&_.cm-editor.cm-focused]:outline-none"
        />
      ) : (
        <DefinitionView />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] font-semibold uppercase tracking-wider transition-colors py-0.5 ${
        active
          ? "text-foreground border-b-2 border-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function DefinitionView() {
  const { selected } = useWidgetStore();
  if (!selected) return null;

  if (selected.type === "tool") {
    const { tool } = selected;
    const schemaText = tool.inputSchema
      ? JSON.stringify(tool.inputSchema, null, 2)
      : null;
    const meta = tool.meta ?? tool._meta;
    const metaText =
      meta && Object.keys(meta).length > 0
        ? JSON.stringify(meta, null, 2)
        : null;
    const ann = tool.annotations;
    const hintBadges = ann ? toolHintBadges(ann) : [];
    return (
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3 text-xs">
          <Field label="Name" value={tool.name} />
          {ann?.title && <Field label="Title" value={ann.title} />}
          {hintBadges.length > 0 && (
            <BadgeRow label="Hints" badges={hintBadges} />
          )}
          {tool.description && (
            <Field label="Description" value={tool.description} multiline />
          )}
          {schemaText && <CodeField label="Input Schema" value={schemaText} />}
          {metaText && <CodeField label="Meta" value={metaText} />}
        </div>
      </ScrollArea>
    );
  }

  if (selected.type === "resource") {
    const { resource } = selected;
    const metaText =
      resource.meta && Object.keys(resource.meta).length > 0
        ? JSON.stringify(resource.meta, null, 2)
        : null;
    const ann = resource.annotations;
    const audienceBadges = ann ? resourceAudienceBadges(ann) : [];
    return (
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3 text-xs">
          <Field label="URI" value={resource.uri} />
          <Field label="Name" value={resource.name} />
          {audienceBadges.length > 0 && (
            <BadgeRow label="Audience" badges={audienceBadges} />
          )}
          {ann?.priority !== undefined && (
            <Field label="Priority" value={ann.priority.toFixed(2)} />
          )}
          {ann?.lastModified && (
            <Field label="Last Modified" value={ann.lastModified} />
          )}
          {resource.description && (
            <Field label="Description" value={resource.description} multiline />
          )}
          {resource.mimeType && (
            <Field label="MIME Type" value={resource.mimeType} />
          )}
          {metaText && <CodeField label="Meta" value={metaText} />}
        </div>
      </ScrollArea>
    );
  }

  return null;
}

interface HintBadge {
  label: string;
  tone: "safe" | "danger" | "info" | "warn";
  /** Spec-verbatim definition shown in the hover tooltip. */
  definition: string;
  /** What the server declared (filled in for boolean hints). */
  declared?: string;
}

// Wording quoted from the MCP 2025-06-18 schema (ToolAnnotations JSDoc) so
// users see the canonical definitions, not paraphrased ones.
function toolHintBadges(ann: McpToolAnnotations): HintBadge[] {
  const out: HintBadge[] = [];
  if (ann.readOnlyHint === true) {
    out.push({
      label: "Read-only",
      tone: "safe",
      declared: "readOnlyHint: true",
      definition: "If true, the tool does not modify its environment.",
    });
  }
  if (ann.destructiveHint === true) {
    out.push({
      label: "Destructive",
      tone: "danger",
      declared: "destructiveHint: true",
      definition:
        "If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates. (Meaningful only when readOnlyHint is false.) Default: true.",
    });
  } else if (ann.destructiveHint === false) {
    out.push({
      label: "Non-destructive",
      tone: "safe",
      declared: "destructiveHint: false",
      definition:
        "If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates. (Meaningful only when readOnlyHint is false.) Default: true.",
    });
  }
  if (ann.idempotentHint === true) {
    out.push({
      label: "Idempotent",
      tone: "info",
      declared: "idempotentHint: true",
      definition:
        "If true, calling the tool repeatedly with the same arguments will have no additional effect on its environment. (Meaningful only when readOnlyHint is false.) Default: false.",
    });
  }
  if (ann.openWorldHint === true) {
    out.push({
      label: "Open-world",
      tone: "warn",
      declared: "openWorldHint: true",
      definition:
        "If true, this tool may interact with an 'open world' of external entities. If false, the tool's domain of interaction is closed. Default: true.",
    });
  } else if (ann.openWorldHint === false) {
    out.push({
      label: "Closed-world",
      tone: "info",
      declared: "openWorldHint: false",
      definition:
        "If true, this tool may interact with an 'open world' of external entities. If false, the tool's domain of interaction is closed. Default: true.",
    });
  }
  return out;
}

function resourceAudienceBadges(ann: McpResourceAnnotations): HintBadge[] {
  if (!ann.audience) return [];
  return ann.audience.map((a) => ({
    label: a === "user" ? "User" : "Assistant",
    tone: "info" as const,
    declared: `audience includes "${a}"`,
    definition:
      "Describes who the intended customer of this object or data is. Can include multiple entries (e.g. user and assistant) when content is useful for both.",
  }));
}

const TONE_CLASS: Record<HintBadge["tone"], string> = {
  safe: "bg-green-500/15 text-green-400 border-green-500/30",
  danger: "bg-red-500/15 text-red-400 border-red-500/30",
  warn: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  info: "bg-secondary text-muted-foreground border-border/60",
};

function BadgeRow({ label, badges }: { label: string; badges: HintBadge[] }) {
  return (
    <TooltipProvider delay={CONFIG.TIMEOUT_TOOLTIP}>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          {label}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <Tooltip key={b.label}>
              <TooltipTrigger
                render={
                  <span
                    className={`cursor-help text-[10px] px-1.5 py-0.5 rounded border ${TONE_CLASS[b.tone]}`}
                  >
                    {b.label}
                  </span>
                }
              />
              <TooltipContent className="max-w-xs flex-col items-start gap-1 text-left">
                <div className="font-semibold">{b.label}</div>
                {b.declared && (
                  <div className="font-mono text-[10px] opacity-70">
                    {b.declared}
                  </div>
                )}
                <div className="text-[11px] leading-snug">{b.definition}</div>
                <div className="text-[10px] opacity-60 italic">
                  Annotation is advisory; clients must treat as untrusted unless
                  the server is trusted.
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <CopyButton value={value} />
      </div>
      <div
        className={`font-mono text-foreground break-words select-text ${
          multiline ? "whitespace-pre-wrap" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function CodeField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <CopyButton value={value} />
      </div>
      <pre className="font-mono text-[11px] whitespace-pre-wrap break-all bg-background text-foreground select-text rounded border border-border/40 p-2">
        {value}
      </pre>
    </div>
  );
}
