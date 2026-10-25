type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/**
 * Builds an element. `on*` attributes become listeners, `true` sets a boolean
 * attribute, and `false`/`undefined` leave it off. Text is always set as text,
 * never HTML, so user-entered names can't inject markup.
 */
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Replaces root's content; null entries are skipped. */
export function mount(root: HTMLElement, ...nodes: (Node | null)[]): void {
  root.replaceChildren(...nodes.filter((n): n is Node => n !== null));
}

export function photoUrl(key: string): string {
  return `/api/photos/${key}`;
}

export function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[place % 10] ?? "th"}`;
}
