// The help page's question filter (SW-24). The page works without it: every
// question is plain HTML, and the filter box stays hidden unless this runs.

/** Lower-case words of the query; a question matches if it contains all of them. */
export function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matches(text: string, query: string[]): boolean {
  return query.every((w) => text.includes(w));
}

/** Shows only matching questions (opened, so the answer is visible), and empty sections go too. */
export function applyFilter(root: ParentNode, query: string): number {
  const q = words(query);
  let shown = 0;
  for (const section of root.querySelectorAll<HTMLElement>(".faq-section")) {
    let inSection = 0;
    for (const item of section.querySelectorAll<HTMLDetailsElement>("details.faq")) {
      const hit = matches(item.dataset.text ?? "", q);
      item.hidden = !hit;
      if (q.length) item.open = hit;
      if (hit) inSection++;
    }
    section.hidden = inSection === 0;
    shown += inSection;
  }
  const none = root.querySelector<HTMLElement>(".help-filter .status");
  if (none) none.hidden = shown > 0;
  return shown;
}

/** Opens the question a link points at (#its-id), so the answer shows straight away. */
export function openTarget(doc: Document, hash: string): void {
  const target = hash.length > 1 ? doc.getElementById(decodeURIComponent(hash.slice(1))) : null;
  if (target instanceof HTMLDetailsElement) target.open = true;
}

export function start(doc: Document, win: Window): void {
  const box = doc.querySelector<HTMLElement>(".help-filter");
  const input = doc.querySelector<HTMLInputElement>("#faq-filter");
  if (!box || !input) return;
  box.hidden = false;
  input.addEventListener("input", () => applyFilter(doc, input.value));
  openTarget(doc, win.location.hash);
  win.addEventListener("hashchange", () => openTarget(doc, win.location.hash));
}
