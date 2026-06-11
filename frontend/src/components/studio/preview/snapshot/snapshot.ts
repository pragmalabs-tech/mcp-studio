export type WidgetSnapshot = {
  id: string;
  html: string; // cloned DOM
  scroll?: { x: number; y: number };
  bounds?: { width: number; height: number };
  createdAt: string;
};

export function getIframeBounds(
  iframe: HTMLIFrameElement,
): { width: number; height: number } | undefined {
  const rect = iframe.getBoundingClientRect();
  const w = rect.width || iframe.offsetWidth;
  const h = rect.height || iframe.offsetHeight;
  return w > 0 && h > 0 ? { width: w, height: h } : undefined;
}

export function serializeIframeDocument(
  id: string,
  iframe: HTMLIFrameElement,
): WidgetSnapshot | undefined {
  const sourceDoc = iframe.contentDocument;
  const sourceWin = iframe.contentWindow;

  if (!sourceDoc || !sourceWin) {
    console.error("Cannot access iframe document");
    return;
  }

  const clonedDoc = sourceDoc.cloneNode(true) as Document;

  replaceCanvasWithImages({
    sourceDoc,
    clonedDoc,
  });

  const html = "<!DOCTYPE html>\n" + clonedDoc.documentElement.outerHTML;

  return {
    id,
    html,
    scroll: {
      x: sourceWin.scrollX,
      y: sourceWin.scrollY,
    },
    bounds: getIframeBounds(iframe),
    createdAt: new Date().toISOString(),
  };
}

type ReplaceCanvasOptions = {
  sourceDoc: Document;
  clonedDoc: Document;
};

function replaceCanvasWithImages({
  sourceDoc,
  clonedDoc,
}: ReplaceCanvasOptions) {
  const sourceCanvases = Array.from(sourceDoc.querySelectorAll("canvas"));
  const clonedCanvases = Array.from(clonedDoc.querySelectorAll("canvas"));

  sourceCanvases.forEach((sourceCanvas, index) => {
    const clonedCanvas = clonedCanvases[index];

    if (!clonedCanvas) return;

    try {
      const dataUrl = canvasToImageDataUrl(sourceCanvas);

      const img = clonedDoc.createElement("img");

      copyCanvasAttributesToImage(clonedCanvas, img);

      img.src = dataUrl;
      img.width = sourceCanvas.width;
      img.height = sourceCanvas.height;

      const sourceStyle = sourceDoc.defaultView?.getComputedStyle(sourceCanvas);

      img.style.width = sourceStyle?.width || `${sourceCanvas.offsetWidth}px`;
      img.style.height =
        sourceStyle?.height || `${sourceCanvas.offsetHeight}px`;
      img.style.display = sourceStyle?.display || "block";
      img.style.objectFit = "contain";

      clonedCanvas.replaceWith(img);
    } catch (error) {
      console.warn("Failed to replace canvas with image:", error);

      const placeholder = clonedDoc.createElement("div");
      placeholder.textContent = "Canvas snapshot unavailable";
      placeholder.style.width = `${sourceCanvas.offsetWidth}px`;
      placeholder.style.height = `${sourceCanvas.offsetHeight}px`;
      placeholder.style.display = "flex";
      placeholder.style.alignItems = "center";
      placeholder.style.justifyContent = "center";
      placeholder.style.background = "#f3f3f3";
      placeholder.style.color = "#777";
      placeholder.style.fontSize = "12px";

      clonedCanvas.replaceWith(placeholder);
    }
  });
}

function canvasToImageDataUrl(
  canvas: HTMLCanvasElement,
  backgroundColor?: string,
): string {
  if (!backgroundColor) {
    return canvas.toDataURL("image/png");
  }

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;

  const ctx = tempCanvas.getContext("2d");

  if (!ctx) {
    throw new Error("Cannot create 2D canvas context");
  }

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  ctx.drawImage(canvas, 0, 0);

  return tempCanvas.toDataURL("image/png");
}

function copyCanvasAttributesToImage(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
) {
  for (const attr of Array.from(canvas.attributes)) {
    if (attr.name === "width") continue;
    if (attr.name === "height") continue;
    if (attr.name === "src") continue;

    img.setAttribute(attr.name, attr.value);
  }
}
