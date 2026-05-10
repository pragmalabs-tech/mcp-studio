// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { queryFind, queryText, queryVisible } from "./dom-query";

const html = `
  <html>
    <body>
      <h1>Weather</h1>
      <p>Temperature: 21°C</p>
      <button data-testid="refresh-btn" aria-label="Refresh weather">↻</button>
      <button>Submit</button>
      <label for="city">City</label>
      <input id="city" placeholder="Enter city" />
      <div hidden>secret</div>
      <span style="display:none">also secret</span>
    </body>
  </html>
`;

describe("queryText", () => {
  it("returns whole-body text when no locator", () => {
    expect(queryText(html)).toContain("Weather");
    expect(queryText(html)).toContain("Temperature: 21°C");
  });

  it("targets via testid", () => {
    expect(queryText(html, { testid: "refresh-btn" })).toBe("↻");
  });

  it("targets via role+name", () => {
    expect(queryText(html, { role: "button", name: "Submit" })).toBe("Submit");
  });

  it("targets via text", () => {
    expect(queryText(html, { text: "Weather" })).toBe("Weather");
  });

  it("returns null on miss", () => {
    expect(queryText(html, { testid: "nope" })).toBeNull();
  });

  it("walks chain locators in order", () => {
    expect(
      queryText(html, {
        chain: [{ testid: "missing" }, { role: "button", name: "Submit" }],
      }),
    ).toBe("Submit");
  });

  it("targets via label", () => {
    const el = queryFind(html, { label: "City" });
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe("input");
  });

  it("targets via placeholder", () => {
    const el = queryFind(html, { placeholder: "Enter city" });
    expect(el).not.toBeNull();
  });
});

describe("queryVisible", () => {
  it("true for normally rendered elements", () => {
    expect(queryVisible(html, { testid: "refresh-btn" })).toBe(true);
  });

  it("false for hidden attribute", () => {
    expect(queryVisible(html, { text: "secret" })).toBe(false);
  });

  it("false for display:none style", () => {
    expect(queryVisible(html, { text: "also secret" })).toBe(false);
  });

  it("false on miss", () => {
    expect(queryVisible(html, { testid: "missing" })).toBe(false);
  });
});
