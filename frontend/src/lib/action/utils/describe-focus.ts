/**
 * Short, human-readable description of what currently holds focus inside a
 * widget document. Used to diagnose focus-loss bugs across replay steps:
 * ephemeral editors (e.g. Excalidraw's `textarea.excalidraw-wysiwyg`) commit
 * and remove themselves on blur, so logging the live `activeElement` at each
 * step's boundaries shows exactly when the editable target appears and
 * disappears.
 */
export interface FocusInfo {
  selector: string;
  editable: boolean;
}

export function describeFocus(doc: Document): FocusInfo {
  const a = doc.activeElement as HTMLElement | null;
  if (!a || a === doc.body || a === doc.documentElement) {
    return { selector: a ? a.tagName.toLowerCase() : "none", editable: false };
  }
  const tag = a.tagName.toLowerCase();
  const id = a.id ? `#${a.id}` : "";
  const cls = a.classList.length
    ? `.${Array.from(a.classList).slice(0, 3).join(".")}`
    : "";
  const editable =
    tag === "input" || tag === "textarea" || a.isContentEditable === true;
  return { selector: `${tag}${id}${cls}`, editable };
}
