// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { captureSelector } from "./capture-selector";

function docOf(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
}

describe("captureSelector", () => {
  it("prefers data-testid above id, class, and structural path", () => {
    const doc = docOf(
      `<button data-testid="submit" id="real" class="btn">Save</button>`,
    );
    const el = doc.querySelector("button")!;
    const sels = captureSelector(el, doc);
    expect(sels[0]).toBe('[data-testid="submit"]');
  });

  it("prefers id (non-autogen) when no testid present", () => {
    const doc = docOf(`<button id="real-button" class="btn">Save</button>`);
    const el = doc.querySelector("button")!;
    const sels = captureSelector(el, doc);
    expect(sels[0]).toBe("#real-button");
  });

  it("skips auto-generated ids (e.g. react-aria, css hashes)", () => {
    const doc = docOf(`<button id=":r3:" class="stable">Save</button>`);
    const el = doc.querySelector("button")!;
    const sels = captureSelector(el, doc);
    // The id is auto-gen — should NOT appear as a candidate.
    expect(sels.find((s) => s.includes(":r3:"))).toBeUndefined();
    // Falls through to tag.stableClass.
    expect(sels[0]).toBe("button.stable");
  });

  it("skips hashed framework class names", () => {
    const doc = docOf(`<button class="css-1a2b3c real-class">Save</button>`);
    const el = doc.querySelector("button")!;
    const sels = captureSelector(el, doc);
    expect(sels.find((s) => s.includes("css-1a2b3c"))).toBeUndefined();
    expect(sels.find((s) => s.endsWith(".real-class"))).toBeDefined();
  });

  it("filters out non-unique selectors", () => {
    const doc = docOf(`
      <button class="btn">A</button>
      <button class="btn">B</button>
    `);
    const el = doc.querySelectorAll("button")[1];
    const sels = captureSelector(el, doc);
    // `button.btn` matches both → should NOT be returned. Structural path
    // singles out the second one.
    expect(sels).not.toContain("button.btn");
    expect(sels.length).toBeGreaterThan(0);
  });

  it("falls back to a structural path when nothing stable is available", () => {
    const doc = docOf(`
      <div><button>A</button><button>B</button></div>
    `);
    const el = doc.querySelectorAll("button")[1];
    const sels = captureSelector(el, doc);
    expect(sels[0]).toContain("button:nth-of-type(2)");
  });

  it("caps the list at MAX_CANDIDATES (4)", () => {
    const doc = docOf(
      `<button data-testid="x" data-test="y" data-cy="z" id="b" class="c">go</button>`,
    );
    const el = doc.querySelector("button")!;
    const sels = captureSelector(el, doc);
    expect(sels.length).toBeLessThanOrEqual(4);
  });

  it("CSS-escapes values with special characters", () => {
    const doc = docOf(`<button data-testid="user:42">Save</button>`);
    const el = doc.querySelector("button")!;
    const sels = captureSelector(el, doc);
    // Result must still resolve back to the same element.
    const found = doc.querySelector(sels[0]);
    expect(found).toBe(el);
  });
});
