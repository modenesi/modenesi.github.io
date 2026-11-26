// Shows the CV PDF on cv.html: each page drawn at the width of the page column (sharp on
// high-resolution screens), with its links clickable and its text selectable and searchable.
// Uses pdf.js (vendor/pdfjs). Pages are drawn when they come near the screen; if drawing
// fails, the last good drawing stays and the next scroll or resize tries again. The page
// starts with a short note, so a blocked script still leaves the Download button to use.
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const box = document.querySelector(".gh-cv-pages");

async function draw(p) {
  const width = p.div.clientWidth;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const key = `${width}x${ratio}`;
  if (!width || !p.near || key === p.key) return;
  p.key = key;
  const token = ++p.token;
  p.task?.cancel();                                // a newer size replaces an unfinished drawing
  try {
    const viewport = p.page.getViewport({ scale: width / p.base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.setAttribute("aria-hidden", "true");
    p.task = p.page.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
    });
    await p.task.promise;
    const text = document.createElement("div");
    text.className = "textLayer";
    await new pdfjsLib.TextLayer({ textContentSource: p.text, container: text, viewport }).render();
    if (token !== p.token) return;                 // superseded while drawing
    p.div.style.setProperty("--total-scale-factor", String(viewport.scale));
    p.div.replaceChildren(canvas, text, p.links);
  } catch (err) {
    if (token !== p.token) return;
    p.key = null;                                  // try again later
    if (!(err instanceof pdfjsLib.RenderingCancelledException)) console.error("CV viewer:", err);
  }
}

// The words printed under a link, so screen readers say "GraphNetz: ..." rather than a URL.
// Text pieces are often whole lines, so keep the part of each piece that lies inside the link
// (by position along the piece), widened to whole words.
function linkText(rect, items) {
  const x1 = Math.min(rect[0], rect[2]), x2 = Math.max(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]), y2 = Math.max(rect[1], rect[3]);
  const parts = [];
  for (const it of items) {
    const x = it.transform[4], y = it.transform[5], w = it.width, str = it.str || "";
    if (!str.trim() || !w || y < y1 - 2 || y > y2 + 2 || x >= x2 || x + w <= x1) continue;
    let i = Math.max(0, Math.round(((x1 - x) / w) * str.length));
    let j = Math.min(str.length, Math.round(((x2 - x) / w) * str.length));
    while (i > 0 && /\S/.test(str[i - 1])) i--;
    while (j < str.length && /\S/.test(str[j])) j++;
    parts.push(str.slice(i, j));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 140);
}

async function linkLayer(page, base, text) {
  const layer = document.createElement("div");
  layer.className = "gh-cv-links";
  for (const a of await page.getAnnotations({ intent: "display" })) {
    if (a.subtype !== "Link" || !a.url) continue;
    const [x1, y1] = base.convertToViewportPoint(a.rect[0], a.rect[1]);
    const [x2, y2] = base.convertToViewportPoint(a.rect[2], a.rect[3]);
    const link = document.createElement("a");
    link.href = a.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = a.url;
    link.setAttribute("aria-label", linkText(a.rect, text.items) || a.url);
    // Percent positions: the links stay in place at any page width.
    link.style.left = (Math.min(x1, x2) / base.width) * 100 + "%";
    link.style.top = (Math.min(y1, y2) / base.height) * 100 + "%";
    link.style.width = (Math.abs(x2 - x1) / base.width) * 100 + "%";
    link.style.height = (Math.abs(y2 - y1) / base.height) * 100 + "%";
    layer.append(link);
  }
  return layer;
}

async function main() {
  if (!box) return;
  const pdf = await pdfjsLib.getDocument({ url: box.dataset.pdf }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const div = document.createElement("div");
    div.className = "gh-cv-page";
    div.setAttribute("role", "group");
    div.setAttribute("aria-label", `Page ${n} of ${pdf.numPages}`);
    div.style.aspectRatio = `${base.width} / ${base.height}`;   // space kept while drawing
    pages.push({ page, base, text, div, links: await linkLayer(page, base, text),
                 key: null, token: 0, near: false, task: null });
  }
  box.replaceChildren(...pages.map((p) => p.div));             // replaces the loading note

  const byDiv = new Map(pages.map((p) => [p.div, p]));
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const p = byDiv.get(e.target);
      p.near = e.isIntersecting;
      if (p.near) draw(p);
    }
  }, { rootMargin: "100% 0px" });                             // one screen ahead and behind
  pages.forEach((p) => near.observe(p.div));

  let timer;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => pages.forEach((p) => draw(p)), 150);
  }).observe(box);
}

main().catch((err) => {
  console.error("CV viewer:", err);
  box.innerHTML = '<p class="gh-cv-msg">The CV could not be shown here. Use “Download PDF” above.</p>';
});
