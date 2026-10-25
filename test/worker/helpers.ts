import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";

export const ORIGIN = "https://example.com";

/** Calls the Worker. `cookie` is sent as the Cookie header. */
export function call(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return exports.default.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
}

export function send(path: string, method: string, body: unknown, cookie?: string): Promise<Response> {
  return call(path, {
    method,
    cookie,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The newest magic link sent to `email`, straight from the dev outbox. */
export async function latestLink(email: string): Promise<string> {
  const row = await env.DB.prepare("SELECT body FROM dev_outbox WHERE to_addr = ? ORDER BY id DESC LIMIT 1")
    .bind(email)
    .first<{ body: string }>();
  const match = row?.body.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`no link emailed to ${email}`);
  return match[0];
}

/** Logs in through the real magic-link flow and returns the session cookie. */
export async function login(email: string): Promise<string> {
  await send("/api/auth/login", "POST", { email });
  const link = new URL(await latestLink(email));
  const res = await call(link.pathname + link.search);
  const setCookie = res.headers.get("set-cookie")!;
  return setCookie.split(";")[0]!;
}

/** Creates an event as `cookie`; returns its id, code and the default category id. */
export async function makeEvent(cookie: string, name = "Chili Night") {
  const res = await send("/api/events", "POST", { name, date: "2026-11-01" }, cookie);
  const { id, code } = await res.json<{ id: string; code: string }>();
  const manage = await (await call(`/api/events/${id}`, { cookie })).json<{ categories: { id: string }[] }>();
  return { id, code, categoryId: manage.categories[0]!.id };
}

/** Adds an entry, optionally with a photo. */
export async function makeEntry(cookie: string, categoryId: string, cookName = "Grandma", dishName = "Red chili", photo?: File) {
  const form = new FormData();
  form.set("cookName", cookName);
  form.set("dishName", dishName);
  if (photo) form.set("photo", photo);
  const res = await call(`/api/categories/${categoryId}/entries`, { method: "POST", cookie, body: form });
  return res.json<{ id: string; number: number; photoKey: string | null }>();
}

export function jpeg(bytes = 10, type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], "dish.jpg", { type });
}

/**
 * Stubs Cloudflare's Turnstile siteverify. The Worker runs in the same isolate
 * as the tests, so spying on the global fetch reaches it.
 */
export function stubTurnstile(success = true, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("challenges.cloudflare.com")) {
      return new Response(JSON.stringify({ success }), { status: ok ? 200 : 500 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

export async function vote(eventId: string, categoryId: string, entryId: string, device?: string) {
  return call(`/api/public/events/${eventId}/votes`, {
    method: "POST",
    cookie: device,
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify({ categoryId, entryId, turnstileToken: "tok" }),
  });
}

export function deviceCookie(res: Response): string {
  return res.headers.get("set-cookie")!.split(";")[0]!;
}
