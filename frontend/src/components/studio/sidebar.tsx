import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  useWidgetStore,
  type SelectedItem,
} from "@/lib/studio/stores/widget-store";
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
  } = useWidgetStore();
  const studioTheme = useWidgetStore((s) => s.studioTheme);
  const setStudioTheme = useWidgetStore((s) => s.setStudioTheme);

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
          <div className="flex items-center gap-1.5 min-w-0">
            <a
              href="https://studio.pragmalabs.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors truncate"
            >
              studio.pragmalabs.tech
            </a>
            <span className="opacity-40 shrink-0">v{__APP_VERSION__}</span>
            <a
              href="https://github.com/pragmalabs-tech/mcp-studio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors shrink-0"
              title="GitHub"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
            </a>
          </div>
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
