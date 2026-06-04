import { describe, it, expect } from "vitest";
import { buildMockFromResponse, resolveWidgetUri } from "./index";
import type { McpResourceInfo } from "@/lib/studio/api";

const resources: McpResourceInfo[] = [
  {
    uri: "ui://widget/weather",
    mimeType: "text/html;profile=mcp-app",
    name: "weather",
  },
  {
    uri: "ui://my-app/index.html",
    mimeType: "text/html;profile=mcp-app",
    name: "my-app",
  },
];

const display = { theme: "dark", locale: "en-US", displayMode: "compact" };

describe("resolveWidgetUri", () => {
  it("returns the matching URI when meta carries an explicit ui.resourceUri", () => {
    expect(
      resolveWidgetUri(
        { ui: { resourceUri: "ui://widget/weather" } },
        null,
        resources,
      ),
    ).toBe("ui://widget/weather");
  });

  it("falls back to fuzzy match against tool name when meta has no ui ref", () => {
    expect(resolveWidgetUri(undefined, "weather", resources)).toBe(
      "ui://widget/weather",
    );
  });

  it("strips common verb prefixes during fuzzy match", () => {
    expect(resolveWidgetUri(undefined, "get_weather", resources)).toBe(
      "ui://widget/weather",
    );
  });

  it("returns null when no matching resource exists", () => {
    expect(resolveWidgetUri(undefined, "stocks", resources)).toBeNull();
  });

  it("returns null when meta is empty and toolName is null", () => {
    expect(resolveWidgetUri(undefined, null, resources)).toBeNull();
  });
});

describe("buildMockFromResponse", () => {
  it("parses JSON from content[].text and uses it as toolOutput", () => {
    const mock = buildMockFromResponse(
      {
        content: [{ type: "text", text: '{"temperature":72}' }],
        _meta: { foo: "bar" },
      },
      { city: "SF" },
      display,
    );
    expect(mock.toolOutput).toEqual({ temperature: 72 });
    expect(mock.toolInput).toEqual({ city: "SF" });
    expect(mock._meta).toEqual({ foo: "bar" });
    expect(mock.theme).toBe("dark");
  });

  it("falls back to raw text when content[].text is not JSON", () => {
    const mock = buildMockFromResponse(
      { content: [{ type: "text", text: "plain" }] },
      {},
      display,
    );
    expect(mock.toolOutput).toBe("plain");
  });

  it("uses the full response when there is no content[].text", () => {
    const mock = buildMockFromResponse({ ok: true }, {}, display);
    expect(mock.toolOutput).toEqual({ ok: true });
  });
});
