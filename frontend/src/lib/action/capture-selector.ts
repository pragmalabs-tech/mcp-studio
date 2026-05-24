/**
 * Capture an ordered list of CSS selector candidates for a clicked element.
 *
 * At replay we try candidates in order; first match wins. Priority is
 * highest-stability first:
 *
 *   1. data-testid / data-test / data-cy / data-qa attributes (explicit
 *      test contract — survives DOM restructuring and styling changes).
 *   2. id, when not auto-generated (skip framework-style ids like
 *      "react-aria-:r3:", "_:r7:", "css-1a2b3c", etc.).
 *   3. tag + first stable class (skip hashed class names).
 *   4. Structural path with nth-of-type from a stable ancestor — last
 *      resort; breaks easily on list reorders.
 *
 * Each candidate is filtered for uniqueness against the supplied root —
 * a selector that matches zero or multiple elements is dropped, since
 * it's worse than useless at replay. Cap output at MAX_CANDIDATES.
 */

const MAX_CANDIDATES = 3;
const LOOKS_AUTOGEN = /^(css-|_|sc-|ember\d|react-aria-|:r\d+:)/;

const TESTID_ATTRS = ["data-testid", "data-test", "data-cy", "data-qa"];

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  // Minimal fallback: escape quotes/backslashes.
  return value.replace(/(["\\])/g, "\\$1");
}

function isUnique(sel: string, el: Element, root: Document): boolean {
  try {
    const matches = root.querySelectorAll(sel);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
}

function stableClass(el: Element): string | null {
  for (const cls of Array.from(el.classList)) {
    if (!LOOKS_AUTOGEN.test(cls)) return cls;
  }
  return null;
}

function structuralPath(el: Element, root: Document): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root.documentElement && cur.parentElement) {
    const parent: Element = cur.parentElement;
    const tag = cur.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter(
      (s) => s.tagName === cur!.tagName,
    );
    const idx = siblings.indexOf(cur) + 1;
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    cur = parent;
  }
  return parts.join(" > ");
}

export function captureSelector(el: Element, root: Document): string[] {
  const candidates: string[] = [];

  for (const attr of TESTID_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) candidates.push(`[${attr}="${cssEscape(v)}"]`);
  }

  if (el.id && !LOOKS_AUTOGEN.test(el.id)) {
    candidates.push(`#${cssEscape(el.id)}`);
  }

  const cls = stableClass(el);
  if (cls) candidates.push(`${el.tagName.toLowerCase()}.${cssEscape(cls)}`);

  candidates.push(structuralPath(el, root));

  // Filter to selectors that uniquely match the element.
  const unique = candidates.filter((sel) => isUnique(sel, el, root));
  return unique.slice(0, MAX_CANDIDATES);
}
