import { ApiError } from "./api";
import { h, mount } from "./dom";
import { codeView, homeView } from "./views/home";
import { manageView } from "./views/manage";
import { printView } from "./views/print";
import { revealView } from "./views/reveal";
import { voteView } from "./views/vote";

export interface Ctx {
  root: HTMLElement;
  url: URL;
  navigate: (path: string) => void;
}

/** A view renders into ctx.root and may return a cleanup (e.g. to stop polling). */
export type View = (ctx: Ctx, ...params: string[]) => Promise<void | (() => void)>;

const ROUTES: [RegExp, View][] = [
  [/^\/$/, homeView],
  [/^\/c\/([^/]+)$/, codeView],
  [/^\/v\/([^/]+)$/, voteView],
  [/^\/e\/([^/]+)$/, manageView],
  [/^\/e\/([^/]+)\/reveal$/, revealView],
  [/^\/e\/([^/]+)\/print\/(poster|cards)$/, printView],
];

export function findRoute(path: string): { view: View; params: string[] } | null {
  for (const [pattern, view] of ROUTES) {
    const m = pattern.exec(path);
    if (m) return { view, params: m.slice(1).map(decodeURIComponent) };
  }
  return null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Please log in first.";
    if (err.status === 403) return "That event belongs to someone else.";
    if (err.status === 404) return "We couldn't find that event.";
    return err.message;
  }
  return "Something went wrong. Check your connection and try again.";
}

export function start(root: HTMLElement, win: Window = window): { go: (path: string) => Promise<void> } {
  let cleanup: void | (() => void);

  async function render(): Promise<void> {
    cleanup?.();
    cleanup = undefined;
    const url = new URL(win.location.href);
    const found = findRoute(url.pathname);
    const ctx: Ctx = { root, url, navigate: (p) => void go(p) };
    if (!found) {
      mount(root, h("h1", {}, "Page not found"), h("p", {}, h("a", { href: "/", "data-link": true }, "Go to the home page")));
      return;
    }
    try {
      cleanup = await found.view(ctx, ...found.params);
    } catch (err) {
      mount(root, h("h1", {}, "Hmm."), h("p", { class: "error" }, errorMessage(err)), h("p", {}, h("a", { href: "/", "data-link": true }, "Home")));
    }
  }

  async function go(path: string): Promise<void> {
    win.history.pushState(null, "", path);
    await render();
  }

  // In-app links carry data-link; everything else is a normal page load.
  root.addEventListener("click", (e) => {
    const a = (e.target as Element).closest("a[data-link]");
    if (!a || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) return;
    e.preventDefault();
    void go(a.getAttribute("href")!);
  });
  win.addEventListener("popstate", () => void render());
  void render();
  return { go };
}
