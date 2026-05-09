import { describe, expect, it } from "vitest";
import { buildSelectorChain } from "./selector";

/**
 * Minimal Element shim for selector unit tests. Not a full DOM — only the bits
 * `buildSelectorChain` reads. Lets us exercise selector priority without
 * pulling in jsdom/happy-dom.
 */
type ElLike = {
  nodeType: 1;
  tagName: string;
  id: string;
  textContent: string;
  parentElement: ElLike | null;
  previousElementSibling: ElLike | null;
  attrs: Record<string, string>;
  getAttribute(name: string): string | null;
};

function el(
  tag: string,
  options: Partial<{
    id: string;
    text: string;
    attrs: Record<string, string>;
    parent: ElLike | null;
    prevSiblings: { tag: string }[];
  }> = {},
): ElLike {
  const attrs = options.attrs ?? {};
  const previousElementSibling: ElLike | null =
    options.prevSiblings && options.prevSiblings.length
      ? buildSiblingChain(options.prevSiblings)
      : null;
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: options.id ?? "",
    textContent: options.text ?? "",
    parentElement: options.parent ?? null,
    previousElementSibling,
    attrs,
    getAttribute(name: string) {
      return name in attrs ? attrs[name] : null;
    },
  };
}

function buildSiblingChain(specs: { tag: string }[]): ElLike {
  let prev: ElLike | null = null;
  let last: ElLike | null = null;
  for (const s of specs) {
    const sib = el(s.tag);
    sib.previousElementSibling = prev;
    prev = sib;
    last = sib;
  }
  return last as ElLike;
}

describe("buildSelectorChain priority", () => {
  it("captures testid when present", () => {
    const target = el("button", { attrs: { "data-testid": "submit-btn" } });
    const chain = buildSelectorChain(target);
    expect(chain.testid).toBe("submit-btn");
  });

  it("captures aria label and role together", () => {
    const target = el("div", {
      attrs: { "aria-label": "Close", role: "button" },
    });
    const chain = buildSelectorChain(target);
    expect(chain.aria).toEqual({ label: "Close", role: "button" });
  });

  it("captures visible text only for text-bearing tags", () => {
    const button = el("button", { text: "  Submit  " });
    const div = el("div", { text: "Submit" });
    expect(buildSelectorChain(button).text).toEqual({
      tag: "button",
      value: "Submit",
    });
    expect(buildSelectorChain(div).text).toBeUndefined();
  });

  it("drops text longer than 80 chars", () => {
    const button = el("button", { text: "a".repeat(120) });
    expect(buildSelectorChain(button).text).toBeUndefined();
  });

  it("normalizes whitespace in text", () => {
    const link = el("a", { text: "Click   me\nnow" });
    expect(buildSelectorChain(link).text).toEqual({
      tag: "a",
      value: "Click me now",
    });
  });

  it("builds css path scoped to nearest id ancestor", () => {
    const root = el("div", { id: "root" });
    const target = el("button", { parent: root });
    const chain = buildSelectorChain(target);
    expect(chain.css).toBe("#root > button:nth-of-type(1)");
  });

  it("uses nth-of-type counted from previous siblings of same tag", () => {
    const root = el("div", { id: "root" });
    const target = el("button", {
      parent: root,
      prevSiblings: [{ tag: "button" }, { tag: "button" }],
    });
    const chain = buildSelectorChain(target);
    expect(chain.css).toBe("#root > button:nth-of-type(3)");
  });

  it("always emits xpath fallback", () => {
    const target = el("span");
    expect(buildSelectorChain(target).xpath).toBe("/span[1]");
  });

  it("returns empty chain for non-element input", () => {
    expect(buildSelectorChain(null)).toEqual({});
    expect(buildSelectorChain({} as unknown)).toEqual({});
    expect(buildSelectorChain("string" as unknown)).toEqual({});
  });

  it("captures all available signals when present together", () => {
    const root = el("section", { id: "panel" });
    const target = el("button", {
      attrs: { "data-testid": "go", "aria-label": "Go", role: "button" },
      text: "Go",
      parent: root,
    });
    const chain = buildSelectorChain(target);
    expect(chain.testid).toBe("go");
    expect(chain.aria).toEqual({ label: "Go", role: "button" });
    expect(chain.text).toEqual({ tag: "button", value: "Go" });
    expect(chain.css).toBe("#panel > button:nth-of-type(1)");
    expect(chain.xpath).toBeDefined();
  });
});
