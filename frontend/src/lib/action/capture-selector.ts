/**
 * Capture an ordered list of CSS selector candidates for an element.
 *
 * Priority follows testing-library / Playwright best-practice consensus —
 * user-visible and accessibility-semantics first, structural path last:
 *
 *   1. data-testid / data-test / data-cy / data-qa  — explicit test contract.
 *   2. id  — stable if not auto-generated.
 *   3. aria-label / aria-labelledby  — role-anchored, survives DOM moves.
 *   4. Form semantics: name, placeholder, type combo  — input-specific &
 *      tightly coupled to the field's function, not its position.
 *   5. tag + first stable class  — layout-independent if class is semantic.
 *   6. Structural path (nth-of-type)  — last resort; breaks on reorders.
 *
 * Each candidate is filtered for uniqueness — a selector matching zero or
 * multiple elements is discarded. Output is capped at MAX_CANDIDATES.
 *
 * References:
 *   - Playwright locator best practices (role → testid → label → css)
 *   - Cypress best practices (data-cy attributes preferred)
 *   - Testing Library "which query should I use?" (role > label > text > id)
 */

const MAX_CANDIDATES = 4;
const LOOKS_AUTOGEN = /^(css-|_|sc-|ember\d|react-aria-|:r\d+:)/;
const FORM_TAGS = new Set(["input", "textarea", "select"]);

const TESTID_ATTRS = ["data-testid", "data-test", "data-cy", "data-qa"];

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
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

/** Semantic selectors specific to form controls (inputs, textareas, selects). */
function formSemantics(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  if (!FORM_TAGS.has(tag)) return [];

  const results: string[] = [];
  const name = el.getAttribute("name");
  const ariaLabel = el.getAttribute("aria-label");
  const placeholder = el.getAttribute("placeholder");
  const type = (el as HTMLInputElement).type;

  // name is the most semantic — it maps directly to form field identity.
  if (name) results.push(`${tag}[name="${cssEscape(name)}"]`);
  if (ariaLabel) results.push(`[aria-label="${cssEscape(ariaLabel)}"]`);
  if (placeholder)
    results.push(`${tag}[placeholder="${cssEscape(placeholder)}"]`);
  // type alone is rarely unique but combined with others helps fallbacks.
  if (type && type !== "text" && type !== "")
    results.push(`${tag}[type="${cssEscape(type)}"]`);

  return results;
}

export function captureSelector(el: Element, root: Document): string[] {
  console.log("[captureSelector] element:", el, {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: el.getAttribute("name"),
    type: (el as HTMLInputElement).type || null,
    ariaLabel: el.getAttribute("aria-label"),
    placeholder: el.getAttribute("placeholder"),
    testid: TESTID_ATTRS.map((a) => el.getAttribute(a)).find(Boolean) ?? null,
    classes: Array.from(el.classList),
  });

  const candidates: string[] = [];

  // 1. Explicit test IDs
  for (const attr of TESTID_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) candidates.push(`[${attr}="${cssEscape(v)}"]`);
  }

  // 2. Non-generated id
  if (el.id && !LOOKS_AUTOGEN.test(el.id)) {
    candidates.push(`#${cssEscape(el.id)}`);
  }

  // 3. ARIA label on element itself
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) candidates.push(`[aria-label="${cssEscape(ariaLabel)}"]`);

  // 4. Form-semantic attributes (name, placeholder, type)
  candidates.push(...formSemantics(el));

  // 5. Tag + first stable class
  const cls = stableClass(el);
  if (cls) candidates.push(`${el.tagName.toLowerCase()}.${cssEscape(cls)}`);

  // 6. Structural path — last resort
  candidates.push(structuralPath(el, root));

  const unique = candidates.filter((sel) => isUnique(sel, el, root));

  console.log("[captureSelector] candidates (unique):", unique);
  return unique.slice(0, MAX_CANDIDATES);
}
