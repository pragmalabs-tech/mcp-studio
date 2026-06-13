import {
  useWidgetStore,
  VIEWPORT_PRESETS,
  type Platform,
  type ViewportPreset,
} from "@/lib/studio/stores/widget-store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONFIG } from "@/lib/config";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

function ProtocolBadges() {
  const detected = useWidgetStore((s) => s.detectedProtocols);
  if (!detected) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1 border-t border-border/50">
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
        Compatibility
      </span>
      <Badge
        variant="outline"
        className={`text-[10px] px-1.5 py-0 ${
          detected.legacyOpenAI || detected.extApps
            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-red-400 bg-red-500/10 text-red-500 dark:text-red-400"
        }`}
      >
        ChatGPT{" "}
        {detected.legacyOpenAI || detected.extApps ? "\u2713" : "\u2717"}
      </Badge>
      <Badge
        variant="outline"
        className={`text-[10px] px-1.5 py-0 ${
          detected.extApps
            ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "border-red-400 bg-red-500/10 text-red-500 dark:text-red-400"
        }`}
      >
        Claude {detected.extApps ? "\u2713" : "\u2717"}
      </Badge>
    </div>
  );
}

export function WidgetConfig() {
  const {
    platform,
    theme,
    locale,
    viewportPreset,
    viewportCustom,
    setPlatform,
    setTheme,
    setLocale,
    setViewportPreset,
    setViewportCustom,
  } = useWidgetStore();

  return (
    <div className="border-b shrink-0 text-xs">
      {/* Row 1: Platform + Widget settings + Viewport */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5">
        <Tabs
          value={platform}
          onValueChange={(v) => setPlatform(v as Platform)}
        >
          <TabsList className="h-7">
            <TabsTrigger value="openai" className="text-xs px-2.5 h-5">
              OpenAI
            </TabsTrigger>
            <TabsTrigger value="claude" className="text-xs px-2.5 h-5">
              Claude
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Separator orientation="vertical" className="h-4" />

        <div className="flex items-center gap-1.5">
          <Label className="text-muted-foreground text-xs whitespace-nowrap">
            Theme
          </Label>
          <Select value={theme} onValueChange={(v) => v && setTheme(v)}>
            <SelectTrigger size="sm" className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <Label className="text-muted-foreground text-xs whitespace-nowrap">
            Locale
          </Label>
          <Input
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="h-7 text-xs w-20"
          />
        </div>

        <Separator orientation="vertical" className="h-4" />

        <div className="flex items-center gap-1.5">
          <Label className="text-muted-foreground text-xs whitespace-nowrap">
            Viewport
          </Label>
          <Select
            value={viewportPreset}
            onValueChange={(v) => v && setViewportPreset(v as ViewportPreset)}
          >
            <SelectTrigger size="sm" className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(VIEWPORT_PRESETS).map(([key, size]) => (
                <SelectItem key={key} value={key}>
                  {key.charAt(0).toUpperCase() + key.slice(1)} ({size.width}x
                  {size.height})
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {viewportPreset === "custom" && (
            <>
              <Input
                type="number"
                min={CONFIG.VIEWPORT_MIN_SIZE_PX}
                max={CONFIG.VIEWPORT_MAX_SIZE_PX}
                value={viewportCustom.width}
                onChange={(e) =>
                  setViewportCustom({
                    width: Math.min(
                      CONFIG.VIEWPORT_MAX_SIZE_PX,
                      Math.max(
                        CONFIG.VIEWPORT_MIN_SIZE_PX,
                        Number(e.target.value) || CONFIG.VIEWPORT_MIN_SIZE_PX,
                      ),
                    ),
                  })
                }
                className="h-7 text-xs w-16"
                title="Width (px)"
              />
              <span className="text-muted-foreground">×</span>
              <Input
                type="number"
                min={CONFIG.VIEWPORT_MIN_SIZE_PX}
                max={CONFIG.VIEWPORT_MAX_SIZE_PX}
                value={viewportCustom.height}
                onChange={(e) =>
                  setViewportCustom({
                    height: Math.min(
                      CONFIG.VIEWPORT_MAX_SIZE_PX,
                      Math.max(
                        CONFIG.VIEWPORT_MIN_SIZE_PX,
                        Number(e.target.value) || CONFIG.VIEWPORT_MIN_SIZE_PX,
                      ),
                    ),
                  })
                }
                className="h-7 text-xs w-16"
                title="Height (px)"
              />
            </>
          )}
        </div>
      </div>

      {/* Row 2: Protocol compatibility badges (after execution) */}
      <ProtocolBadges />
    </div>
  );
}
