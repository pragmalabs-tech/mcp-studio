import type { SelectorChain } from "./schema";

const TEXT_BEARING_TAGS = new Set([
  "button",
  "a",
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "summary",
]);

const MAX_TEXT_LEN = 80;

function isElement(node: unknown): node is Element {
  return (
    !!node &&
    typeof node === "object" &&
    (node as Element).nodeType === 1 &&
    typeof (node as Element).tagName === "string"
  );
}

function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v == null ? undefined : v;
}

function visibleText(el: Element): string | undefined {
  const raw = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  if (!raw || raw.length > MAX_TEXT_LEN) return undefined;
  return raw;
}

function nthOfType(el: Element): number {
  let i = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) i++;
    sib = sib.previousElementSibling;
  }
  return i;
}

function cssEscape(value: string): string {
  const g = globalThis as unknown as {
    CSS?: { escape?: (v: string) => string };
  };
  if (g.CSS && typeof g.CSS.escape === "function") return g.CSS.escape(value);
  return value.replace(/(["\\])/g, "\\$1");
}

function shortCssPath(el: Element): string | undefined {
  const segments: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    const id = cur.id;
    if (id) {
      segments.unshift(`#${cssEscape(id)}`);
      return segments.join(" > ");
    }
    const tag = cur.tagName.toLowerCase();
    const seg = `${tag}:nth-of-type(${nthOfType(cur)})`;
    segments.unshift(seg);
    cur = cur.parentElement;
    if (segments.length > 6) break;
  }
  return segments.length ? segments.join(" > ") : undefined;
}

function xpath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase();
    const idx = nthOfType(cur);
    parts.unshift(`${tag}[${idx}]`);
    cur = cur.parentElement;
  }
  return "/" + parts.join("/");
}

export function buildSelectorChain(target: unknown): SelectorChain {
  if (!isElement(target)) return {};
  const out: SelectorChain = {};

  const testid = attr(target, "data-testid");
  if (testid) out.testid = testid;

  const ariaLabel = attr(target, "aria-label");
  const role = attr(target, "role");
  if (ariaLabel || role) {
    out.aria = {};
    if (ariaLabel) out.aria.label = ariaLabel;
    if (role) out.aria.role = role;
  }

  const tag = target.tagName.toLowerCase();
  if (TEXT_BEARING_TAGS.has(tag)) {
    const text = visibleText(target);
    if (text) out.text = { tag, value: text };
  }

  const css = shortCssPath(target);
  if (css) out.css = css;

  out.xpath = xpath(target);

  return out;
}

function escapeAttr(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}

function findByText(
  root: ParentNode,
  tag: string,
  value: string,
): Element | null {
  const list = root.querySelectorAll(tag);
  for (const el of Array.from(list)) {
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
    if (text === value) return el;
  }
  return null;
}

export function resolveSelectorChain(
  root: Document | ParentNode,
  chain: SelectorChain,
): Element | null {
  if (chain.testid) {
    const el = root.querySelector(
      `[data-testid="${escapeAttr(chain.testid)}"]`,
    );
    if (el) return el;
  }

  if (chain.aria?.label) {
    const sel = chain.aria.role
      ? `[aria-label="${escapeAttr(chain.aria.label)}"][role="${escapeAttr(chain.aria.role)}"]`
      : `[aria-label="${escapeAttr(chain.aria.label)}"]`;
    const el = root.querySelector(sel);
    if (el) return el;
  }

  if (chain.text) {
    const el = findByText(root, chain.text.tag, chain.text.value);
    if (el) return el;
  }

  if (chain.css) {
    try {
      const el = root.querySelector(chain.css);
      if (el) return el;
    } catch {
      /* invalid selector — fall through */
    }
  }

  if (chain.xpath && "evaluate" in (root as Document)) {
    try {
      const doc = root as Document;
      const result = doc.evaluate(
        chain.xpath,
        doc,
        null,
        9, // XPathResult.FIRST_ORDERED_NODE_TYPE
        null,
      );
      const node = result.singleNodeValue;
      if (isElement(node)) return node;
    } catch {
      /* malformed xpath */
    }
  }

  return null;
}
