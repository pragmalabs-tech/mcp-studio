/**
 * Host-side DOM querying for `widget.expect.text` and `widget.expect.visible`.
 * Parses snapshot HTML returned by `bridge-client.ts:snapshot()`. Avoids
 * adding a new bridge protocol message in v1; if these queries become hot,
 * promote them into the iframe bridge directly.
 *
 * Locator resolution order matches `recorder-bridge.js:resolveSelectorChain`:
 * testid > role(+name) > label > placeholder > alt > title > text > css.
 */

import type { Locator } from "./schema";

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function findOne(doc: Document, locator: Locator): Element | null {
  if ("chain" in locator) {
    for (const sub of locator.chain) {
      const hit = findOne(doc, sub);
      if (hit) return hit;
    }
    return null;
  }
  if ("testid" in locator) {
    return doc.querySelector(`[data-testid="${escapeAttr(locator.testid)}"]`);
  }
  if ("role" in locator) {
    const role = locator.role;
    const candidates = doc.querySelectorAll(
      `[role="${escapeAttr(role)}"], ${implicitRoleSelector(role)}`,
    );
    if (!("name" in locator) || locator.name === undefined) {
      return candidates[0] ?? null;
    }
    const want = locator.name;
    for (const el of Array.from(candidates)) {
      const accName = accessibleName(el);
      if (matchesName(accName, want)) return el;
    }
    return null;
  }
  if ("label" in locator) {
    const labels = doc.querySelectorAll("label");
    for (const lab of Array.from(labels)) {
      if (normalizeText(lab.textContent).includes(locator.label)) {
        const forId = lab.getAttribute("for");
        if (forId) {
          const target = doc.getElementById(forId);
          if (target) return target;
        }
        const inner = lab.querySelector("input, textarea, select");
        if (inner) return inner;
      }
    }
    return null;
  }
  if ("placeholder" in locator) {
    return doc.querySelector(
      `[placeholder="${escapeAttr(locator.placeholder)}"]`,
    );
  }
  if ("alt" in locator) {
    return doc.querySelector(`[alt="${escapeAttr(locator.alt)}"]`);
  }
  if ("title" in locator) {
    return doc.querySelector(`[title="${escapeAttr(locator.title)}"]`);
  }
  if ("text" in locator) {
    return findByVisibleText(doc, locator.text, locator.exact === true);
  }
  if ("css" in locator) {
    try {
      return doc.querySelector(locator.css);
    } catch {
      return null;
    }
  }
  return null;
}

function findByVisibleText(
  doc: Document,
  text: string,
  exact: boolean,
): Element | null {
  const want = exact ? text : text.toLowerCase();
  const all = Array.from(doc.querySelectorAll<HTMLElement>("*"));
  // Walk in document order; pick the smallest element whose own text matches.
  for (const el of all) {
    if (el.children.length > 0) continue;
    const t = normalizeText(el.textContent);
    if (exact ? t === text : t.toLowerCase().includes(want)) {
      return el;
    }
  }
  for (const el of all) {
    const t = normalizeText(el.textContent);
    if (exact ? t === text : t.toLowerCase().includes(want)) {
      return el;
    }
  }
  return null;
}

function matchesName(
  actual: string,
  want: string | { matches: string },
): boolean {
  if (typeof want === "string") return actual === want;
  try {
    return new RegExp(want.matches).test(actual);
  } catch {
    return false;
  }
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ref = el.ownerDocument?.getElementById(labelledBy);
    if (ref) return normalizeText(ref.textContent);
  }
  return normalizeText(el.textContent);
}

function implicitRoleSelector(role: string): string {
  switch (role) {
    case "button":
      return "button, input[type=button], input[type=submit]";
    case "link":
      return "a[href]";
    case "textbox":
      return "input[type=text], input:not([type]), textarea";
    case "checkbox":
      return "input[type=checkbox]";
    case "radio":
      return "input[type=radio]";
    case "img":
      return "img";
    case "heading":
      return "h1, h2, h3, h4, h5, h6";
    case "list":
      return "ul, ol";
    case "listitem":
      return "li";
    default:
      return `*[role=__nope__]`;
  }
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '\\"');
}

function isVisible(el: Element): boolean {
  if (el.getAttribute("hidden") !== null) return false;
  const style = (el as HTMLElement).style;
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false;
  }
  // Attribute-level checks only; we don't have layout in the parsed doc, so
  // this is best-effort. Use `hidden`, `style.display=none`, and absence of
  // text content as the signal.
  return true;
}

function parse(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

/** Parsed HTML cache so back-to-back assertions on one snapshot don't
 *  re-parse. Caller passes a stable string reference. */
const docCache = new WeakMap<object, Document>();
function docFor(htmlBox: { html: string }): Document {
  const cached = docCache.get(htmlBox);
  if (cached) return cached;
  const d = parse(htmlBox.html);
  docCache.set(htmlBox, d);
  return d;
}

/** Return the visible text inside the located element (or the whole body
 *  when no locator). Returns `null` when the locator misses. */
export function queryText(html: string, locator?: Locator): string | null {
  const doc = parse(html);
  if (!locator) return normalizeText(doc.body?.textContent);
  const el = findOne(doc, locator);
  if (!el) return null;
  return normalizeText(el.textContent);
}

/** Return whether a locator resolves to an element that looks visible.
 *  Best-effort: relies on attribute hints (`hidden`, `style.display`)
 *  since the parsed document has no layout. */
export function queryVisible(html: string, locator: Locator): boolean {
  const doc = parse(html);
  const el = findOne(doc, locator);
  if (!el) return false;
  return isVisible(el);
}

/** Locate by chain semantics, returning the first matching element or null.
 *  Exposed for `widget.wait_for` polling. */
export function queryFind(html: string, locator: Locator): Element | null {
  return findOne(parse(html), locator);
}

export const _internal = { docFor, normalizeText };
