/**
 * Serialize a Document to HTML, replacing each <canvas> with an <img> whose
 * src is the canvas's toDataURL() snapshot.
 *
 * outerHTML alone cannot capture canvas pixel content — the drawing lives in
 * a GPU/memory buffer, not the DOM. When the snapshot HTML is later rendered
 * in a sandboxed iframe (no scripts), every canvas appears blank. Swapping
 * each canvas for an img preserves the visual state at capture time.
 *
 * Tainted (cross-origin) canvases silently remain as canvas elements.
 * Empty canvases (toDataURL returns the stub "data:,") are left as-is too.
 */
export function serializeDoc(doc: Document): string {
  const liveCanvases = Array.from(
    doc.querySelectorAll("canvas"),
  ) as HTMLCanvasElement[];
  if (liveCanvases.length === 0) return doc.documentElement.outerHTML;

  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  const clonedCanvases = Array.from(
    clone.querySelectorAll("canvas"),
  ) as HTMLCanvasElement[];

  liveCanvases.forEach((canvas, i) => {
    const placeholder = clonedCanvases[i];
    if (!placeholder?.parentNode) return;

    let dataUrl: string | null = null;
    try {
      dataUrl = canvas.toDataURL();
    } catch {
      return; // SecurityError: tainted cross-origin canvas — leave as-is
    }

    if (!dataUrl || dataUrl === "data:,") return; // empty canvas, nothing to capture

    const img = doc.createElement("img");
    for (const { name, value } of Array.from(placeholder.attributes)) {
      img.setAttribute(name, value);
    }
    img.src = dataUrl;
    placeholder.parentNode.replaceChild(img, placeholder);
  });

  return clone.outerHTML;
}
