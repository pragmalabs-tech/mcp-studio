import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useStudioStore } from "@/lib/studio/store";
import type { SelectedItem } from "@/lib/studio/store";
import type { McpToolInfo } from "@/lib/studio/api";
import {
  ToolCategory,
  TOOL_CATEGORY_META,
  TOOL_CATEGORY_ORDER,
  classifyTool,
  type ToolCategoryTone,
} from "@/lib/studio/tool-category";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AuthPanel } from "./auth-panel";
import { CloudPanel } from "./cloud-panel";
import { ProfilePanel } from "./profile-panel";

function displayName(name: string) {
  return name.replace(/_/g, " ");
}

const SECTION_TONE_CLASS: Record<
  ToolCategoryTone | "resource" | "neutral",
  string
> = {
  interactive: "text-violet-500/90 hover:text-violet-400",
  readonly: "text-sky-500/90 hover:text-sky-400",
  destructive: "text-amber-500/90 hover:text-amber-400",
  other: "text-slate-400/90 hover:text-slate-300",
  resource: "text-emerald-500/90 hover:text-emerald-400",
  neutral: "text-muted-foreground hover:text-foreground",
};

export function Sidebar() {
  const {
    tools,
    resources,
    loading,
    loadingStatus,
    mcpError,
    selected,
    loadAll,
    select,
  } = useStudioStore();
  const studioTheme = useStudioStore((s) => s.studioTheme);
  const setStudioTheme = useStudioStore((s) => s.setStudioTheme);

  const [filter, setFilter] = useState("");
  const [sections, setSections] = useState({
    tools: true,
    resources: true,
    [ToolCategory.Interactive]: true,
    [ToolCategory.ReadOnly]: true,
    [ToolCategory.Destructive]: true,
    [ToolCategory.Other]: true,
  });
  type SectionKey = keyof typeof sections;
  const toggleSection = (key: SectionKey) =>
    setSections((s) => ({ ...s, [key]: !s[key] }));

  useEffect(() => {
    loadAll();
  }, []);

  // Normalize both query and candidate to alphanumeric-lowercase so the
  // search matches across snake_case, kebab-case, camelCase, and the
  // human "get course" rendering of `get_course` interchangeably.
  const q = filter.toLowerCase().replace(/[^a-z0-9]/g, "");
  const filteredTools = useMemo(
    () =>
      q
        ? tools.filter(
            (t) =>
              t.name
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .includes(q) ||
              t.description
                ?.toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .includes(q),
          )
        : tools,
    [tools, q],
  );
  const filteredResources = useMemo(
    () =>
      q
        ? resources.filter(
            (r) =>
              r.name
                ?.toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .includes(q) ||
              r.uri
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .includes(q),
          )
        : resources,
    [resources, q],
  );

  function isItemSelected(item: SelectedItem): boolean {
    if (!selected) return false;
    if (selected.type !== item.type) return false;
    if (item.type === "tool" && selected.type === "tool")
      return item.tool.name === selected.tool.name;
    if (item.type === "resource" && selected.type === "resource")
      return item.resource.uri === selected.resource.uri;
    return false;
  }

  const itemBtn = (item: SelectedItem, label: string, sublabel?: string) => (
    <button
      onClick={() => select(item)}
      title={sublabel || label}
      className={`w-full text-left px-3 py-1 hover:bg-secondary/50 transition-colors ${
        isItemSelected(item)
          ? "bg-secondary text-foreground"
          : "text-muted-foreground"
      }`}
    >
      <span className="block text-xs truncate">{label}</span>
      {sublabel && (
        <span className="block text-[10px] text-muted-foreground/60 truncate">
          {sublabel}
        </span>
      )}
    </button>
  );

  const groupedTools = useMemo(() => {
    const groups = new Map<ToolCategory, McpToolInfo[]>();
    for (const t of filteredTools) {
      const cat = classifyTool(t);
      const bucket = groups.get(cat) ?? [];
      bucket.push(t);
      groups.set(cat, bucket);
    }
    return TOOL_CATEGORY_ORDER.map((cat) => ({
      cat,
      tools: groups.get(cat) ?? [],
    })).filter((g) => g.tools.length > 0);
  }, [filteredTools]);

  const sectionHeader = (
    key: SectionKey,
    label: string,
    count: number,
    opts?: {
      icon?: LucideIcon | null;
      description?: string;
      tone?: ToolCategoryTone | "resource" | "neutral";
    },
  ) => {
    const Icon = opts?.icon ?? null;
    const toneClass = SECTION_TONE_CLASS[opts?.tone ?? "neutral"];
    const expanded = filter ? true : sections[key];
    return (
      <button
        onClick={() => toggleSection(key)}
        title={opts?.description}
        aria-expanded={expanded}
        className={`w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${toneClass} hover:bg-secondary/30 transition-colors`}
      >
        <span className="flex items-center gap-1.5">
          {Icon && <Icon className="h-3 w-3" />}
          {label}{" "}
          <span className="normal-case font-normal opacity-70">{count}</span>
        </span>
        <span className="text-[8px]">{expanded ? "▼" : "▶"}</span>
      </button>
    );
  };

  const totalItems = tools.length + resources.length;

  return (
    <div className="w-72 shrink-0 border-r flex flex-col h-full">
      {/* Per-server credentials — top of sidebar so MCP work has the most
          immediate vertical real estate. */}
      <AuthPanel />

      {/* Search */}
      {totalItems > 5 && (
        <div className="px-3 py-2 border-b shrink-0">
          <Input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      )}

      {/* Sections */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-3 py-3 space-y-1">
            <p className="text-muted-foreground text-xs">
              {loadingStatus || "Loading…"}
            </p>
            <div className="h-0.5 bg-secondary rounded overflow-hidden">
              <div className="h-full bg-primary/50 rounded animate-pulse w-2/3" />
            </div>
          </div>
        )}

        {filteredTools.length > 0 &&
          (groupedTools.length === 1 ? (
            <div>
              {sectionHeader("tools", "Tools", filteredTools.length)}
              {(filter ? true : sections.tools) &&
                filteredTools.map((t) => (
                  <div key={t.name}>
                    {itemBtn(
                      { type: "tool", tool: t },
                      displayName(t.name),
                      t.description,
                    )}
                  </div>
                ))}
            </div>
          ) : (
            groupedTools.map(({ cat, tools: bucketTools }) => {
              const meta = TOOL_CATEGORY_META[cat];
              const expanded = filter ? true : sections[cat];
              return (
                <div key={cat}>
                  {sectionHeader(cat, meta.label, bucketTools.length, {
                    icon: meta.icon,
                    description: meta.description,
                    tone: meta.tone,
                  })}
                  {expanded &&
                    bucketTools.map((t) => (
                      <div key={t.name}>
                        {itemBtn(
                          { type: "tool", tool: t },
                          displayName(t.name),
                          t.description,
                        )}
                      </div>
                    ))}
                </div>
              );
            })
          ))}

        {filteredResources.length > 0 && (
          <div>
            {sectionHeader("resources", "Resources", filteredResources.length, {
              tone: "resource",
            })}
            {(filter ? true : sections.resources) &&
              filteredResources.map((r) => (
                <div key={r.uri}>
                  {itemBtn(
                    { type: "resource", resource: r },
                    r.name || r.uri,
                    r.description,
                  )}
                </div>
              ))}
          </div>
        )}

        {!loading && mcpError && (
          <div className="px-3 py-3 space-y-2">
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1">
                Connection Error
              </p>
              {mcpError.split("\n").map((line, i) => (
                <p key={i} className="text-xs text-red-300/90 break-all">
                  {line}
                </p>
              ))}
            </div>
            <button
              onClick={() => loadAll()}
              className="w-full text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !mcpError && totalItems === 0 && (
          <p className="text-muted-foreground text-xs px-3 py-3">
            No tools or resources found.
          </p>
        )}
      </div>

      {/* Bottom meta cluster: cloud account + publish, profile (MCP server
          target), and theme/credit. Lifted onto a subtle muted background
          so it reads as a distinct footer zone vs. the scrolling
          tools/resources list above. */}
      <div className="bg-muted/40 border-t shrink-0">
        <CloudPanel />
        <ProfilePanel />

        <div className="px-4 py-3 border-t text-[10px] text-muted-foreground flex items-center justify-between gap-2">
          <a
            href="https://pragmalabs.tech/studio"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors truncate"
          >
            pragmalabs.tech/studio
          </a>
          <div className="flex items-center gap-1.5 shrink-0">
            <Switch
              size="sm"
              checked={studioTheme === "dark"}
              onCheckedChange={(checked) =>
                setStudioTheme(checked ? "dark" : "light")
              }
            />
            <Label
              className="text-[10px] text-muted-foreground cursor-pointer"
              onClick={() =>
                setStudioTheme(studioTheme === "dark" ? "light" : "dark")
              }
            >
              Dark
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
}
