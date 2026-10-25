import { vi } from "vitest";
import type { Ctx } from "../../src/client/app";

type Reply = unknown | [number, unknown] | ((body: unknown) => unknown | [number, unknown]);

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Fakes the API. Keys are "METHOD /path"; a value is the 200 JSON body, a
 * [status, body] pair, or a function of the request body returning either.
 * Unmatched requests get a 404. Every call is recorded.
 */
export function fakeApi(routes: Record<string, Reply>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      calls.push({ method, path, body });
      let reply = routes[`${method} ${path}`];
      if (typeof reply === "function") reply = (reply as (b: unknown) => unknown)(body);
      if (reply === undefined) reply = [404, { error: "Not found" }];
      const [status, json] = Array.isArray(reply) && typeof reply[0] === "number" && reply.length === 2 ? reply : [200, reply];
      return new Response(JSON.stringify(json), { status: status as number });
    }),
  );
  return calls;
}

export function makeCtx(path = "/") {
  const root = document.createElement("main");
  document.body.replaceChildren(root);
  const navigate = vi.fn<(path: string) => void>();
  return { root, url: new URL(`http://localhost${path}`), navigate } satisfies Ctx;
}

/** Lets pending promises and their DOM updates settle. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

export function byText(root: ParentNode, selector: string, text: string): HTMLElement {
  const el = [...root.querySelectorAll<HTMLElement>(selector)].find((e) => e.textContent?.includes(text));
  if (!el) throw new Error(`no ${selector} containing "${text}"`);
  return el;
}

export function submit(form: Element): void {
  form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

export function fill(root: ParentNode, name: string, value: string): void {
  (root.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
}
