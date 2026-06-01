import type { WidgetPlatform } from "./render-html";

interface WidgetColors {
  background?: string;
}

// CSS custom properties are used so colors respond automatically to
// dark/light class toggling without React re-renders.
// --bg-100 is only defined in the real Claude app environment;
// var(--background) is the fallback for the mcp-studio preview.
const COLORS: Partial<Record<WidgetPlatform, WidgetColors>> = {
  claude: { background: "var(--bg-100, var(--background))" },
};

export function getWidgetColors(platform: WidgetPlatform): WidgetColors {
  return COLORS[platform] ?? { background: "var(--background)" };
}
