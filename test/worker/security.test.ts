// SW-19 security scan: headers, redirects, cross-site requests, login-link rate
// limits, photo checks and Turnstile binding.

import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_LINKS_PER_EMAIL_PER_HOUR, MAX_LINKS_PER_IP_PER_HOUR, safeNext } from "../../src/worker/auth";
import worker, { matchPath } from "../../src/worker/index";
import { sniffImageType } from "../../src/worker/photos";
import { CSP } from "../../src/worker/security";
import { verifyTurnstile } from "../../src/worker/turnstile";
import { call, jpeg, ORIGIN, latestLink, login, makeEntry, makeEvent, send, SIGNATURES } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const PROD = { ...env, APP_ORIGIN: "https://cookoffchamps.com" };

describe("security headers", () => {
  it("sets them on static assets", async () => {
    const res = await call("/");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    // Static assets keep their own caching; only the API defaults to no-store.
    expect(res.headers.get("cache-control")).not.toBe("no-store");
  });

  it("sets them on API responses and errors, which are never cached", async () => {
    for (const path of ["/api/health", "/api/me", "/api/nope"]) {
      const res = await call(path);
      expect(res.headers.get("content-security-policy")).toBe(CSP);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("allows Turnstile and nothing else from off-site", () => {
    expect(CSP).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(CSP).toContain("frame-src https://challenges.cloudflare.com");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).toContain("object-src 'none'");
  });

  it("sends HSTS only when the site is served over https", async () => {
    expect((await call("/api/health")).headers.get("strict-transport-security")).toBeNull();
    const res = await worker.fetch(new Request("https://cookoffchamps.com/api/health"), PROD);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("keeps a photo's own stricter policy and long cache", async () => {
    await env.PHOTOS.put("events/sec/one", "x", { httpMetadata: { contentType: "image/png" } });
    const res = await call("/api/photos/events/sec/one");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});

describe("canonical redirects", () => {
  it("sends plain http to https in production, with the headers", async () => {
    const res = await worker.fetch(new Request("http://cookoffchamps.com/v/abc?x=1"), PROD);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://cookoffchamps.com/v/abc?x=1");
    expect(res.headers.get("strict-transport-security")).not.toBeNull();
  });

  it("sends http://www straight to the https apex", async () => {
    const res = await worker.fetch(new Request("http://www.cookoffchamps.com/api/me"), PROD);
    expect(res.headers.get("location")).toBe("https://cookoffchamps.com/api/me");
  });

  it("leaves plain http alone in local dev", async () => {
    const res = await worker.fetch(new Request("http://localhost:8787/api/health"), env);
    expect(res.status).toBe(200);
  });
});

describe("cross-site requests", () => {
  it("refuses a state change whose Origin is another site", async () => {
    const cookie = await login("csrf@example.com");
    const res = await call("/api/events", {
      method: "POST",
      cookie,
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cross-site request refused" });
    const { events } = await (await call("/api/events", { cookie })).json<{ events: unknown[] }>();
    expect(events).toEqual([]);
  });

  it("refuses another scheme or port of the same host", async () => {
    for (const origin of ["http://example.com", "https://example.com:8443", "https://www.example.com"]) {
      expect((await call("/api/auth/logout", { method: "POST", headers: { origin } })).status).toBe(403);
    }
  });

  it("refuses an opaque 'null' origin too", async () => {
    const res = await call("/api/auth/logout", { method: "POST", headers: { origin: "null" } });
    expect(res.status).toBe(403);
  });

  it("allows the site's own origin, no origin, and cross-site reads", async () => {
    const cookie = await login("same@example.com");
    const own = await call("/api/events", {
      method: "POST",
      cookie,
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ name: "Ours" }),
    });
    expect(own.status).toBe(201);
    expect((await send("/api/events", "POST", { name: "Scripted" }, cookie)).status).toBe(201);
    expect((await call("/api/health", { headers: { origin: "https://evil.example" } })).status).toBe(200);
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/e/abc?x=1#y")).toBe("/e/abc?x=1#y");
  });

  it("refuses everything a browser could read as another site", () => {
    for (const next of [null, "", "e/abc", "https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\u007f"]) {
      expect(safeNext(next)).toBe("/");
    }
  });

  it("refuses a backslash next on the verify link", async () => {
    await send("/api/auth/login", "POST", { email: "slash@example.com" });
    const link = new URL(await latestLink("slash@example.com"));
    const res = await call(`/api/auth/verify?token=${link.searchParams.get("token")}&next=${encodeURIComponent("/\\evil.example")}`);
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("login-link rate limits", () => {
  const ask = (email: string, ip?: string) =>
    call("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) },
      body: JSON.stringify({ email }),
    });

  it("caps links to one address per hour", async () => {
    for (let i = 0; i < MAX_LINKS_PER_EMAIL_PER_HOUR; i++) expect((await ask("flood@example.com")).status).toBe(200);
    const res = await ask("flood@example.com");
    expect(res.status).toBe(429);
    expect((await res.json<{ error: string }>()).error).toMatch(/Too many login links/);
    // No email was queued for the refused request.
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_addr = ?").bind("flood@example.com").first<{ n: number }>())!;
    expect(n).toBe(MAX_LINKS_PER_EMAIL_PER_HOUR);
    // Other addresses are unaffected.
    expect((await ask("calm@example.com")).status).toBe(200);
  });

  it("caps links from one client per hour, across addresses, and stores the IP hashed", async () => {
    for (let i = 0; i < MAX_LINKS_PER_IP_PER_HOUR; i++) expect((await ask(`spray${i}@example.com`, "198.51.100.7")).status).toBe(200);
    expect((await ask("spray-last@example.com", "198.51.100.7")).status).toBe(429);
    expect((await ask("spray-last@example.com", "198.51.100.8")).status).toBe(200);
    const row = await env.DB.prepare("SELECT ip_hash FROM login_tokens WHERE email = 'spray0@example.com'").first<{ ip_hash: string }>();
    expect(row!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("counts only the last hour", async () => {
    for (let i = 0; i < MAX_LINKS_PER_EMAIL_PER_HOUR; i++) await ask("later@example.com");
    await env.DB.prepare("UPDATE login_tokens SET created_at = '2000-01-01T00:00:00Z' WHERE email = 'later@example.com'").run();
    expect((await ask("later@example.com")).status).toBe(200);
  });

  it("applies to co-organizer invites, and a refused invite adds no organizer", async () => {
    const cookie = await login("inviter@example.com");
    const { id } = await makeEvent(cookie);
    for (let i = 0; i < MAX_LINKS_PER_EMAIL_PER_HOUR; i++) await ask("target@example.com");
    const res = await send(`/api/events/${id}/organizers`, "POST", { email: "target@example.com" }, cookie);
    expect(res.status).toBe(429);
    const row = await env.DB.prepare("SELECT 1 FROM organizers WHERE event_id = ? AND email = ?").bind(id, "target@example.com").first();
    expect(row).toBeNull();
  });

  it("purges long-expired tokens and expired sessions", async () => {
    await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ('old', 'o@example.com', '2000-01-01T00:00:00Z')").run();
    await env.DB.prepare("INSERT INTO sessions (id_hash, email, expires_at) VALUES ('old', 'o@example.com', '2000-01-01T00:00:00Z')").run();
    await ask("trigger@example.com");
    expect(await env.DB.prepare("SELECT 1 FROM login_tokens WHERE token_hash = 'old'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM sessions WHERE id_hash = 'old'").first()).toBeNull();
  });
});

describe("photo checks", () => {
  it("knows JPEG, PNG and WebP by their bytes", () => {
    for (const [type, sig] of Object.entries(SIGNATURES)) expect(sniffImageType(new Uint8Array([...sig, 0, 0]))).toBe(type);
    expect(sniffImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull(); // RIFF AVI
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("refuses a file that only claims to be an image", async () => {
    const cookie = await login("sniff@example.com");
    const { categoryId } = await makeEvent(cookie);
    const form = new FormData();
    form.set("cookName", "A");
    form.set("dishName", "B");
    form.set("photo", new File(["<html><script>alert(1)</script></html>"], "x.jpg", { type: "image/jpeg" }));
    const res = await call(`/api/categories/${categoryId}/entries`, { method: "POST", cookie, body: form });
    expect(res.status).toBe(415);
    const { results } = await env.PHOTOS.list({ prefix: "events/" }).then((l) => ({ results: l.objects.filter((o) => o.key.includes(categoryId)) }));
    expect(results).toEqual([]);
  });

  it("stores the type the bytes show, not the one declared", async () => {
    const cookie = await login("liar@example.com");
    const { categoryId } = await makeEvent(cookie);
    const webp = jpeg(16, "image/webp");
    const disguised = new File([await webp.arrayBuffer()], "x.png", { type: "image/png" });
    const entry = await makeEntry(cookie, categoryId, "A", "B", disguised);
    expect((await env.PHOTOS.head(entry.photoKey!))!.httpMetadata!.contentType).toBe("image/webp");
  });

  it("caches photos by path, so a query string can't force an R2 read", async () => {
    await env.PHOTOS.put("events/sec/q", "first", { httpMetadata: { contentType: "image/jpeg" } });
    await call("/api/photos/events/sec/q");
    await env.PHOTOS.put("events/sec/q", "second");
    const res = await call("/api/photos/events/sec/q?bust=123");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("first");
  });
});

describe("routing robustness", () => {
  it("treats a malformed escape in a path as not found, not a crash", async () => {
    expect(matchPath("/api/events/:id", "/api/events/%E0%A4%A")).toBeNull();
    const res = await call("/api/events/%E0%A4%A");
    expect(res.status).toBe(404);
  });
});

describe("vote input", () => {
  it("rejects ids that aren't strings with a 400, not a crash", async () => {
    const cookie = await login("types@example.com");
    const { id } = await makeEvent(cookie);
    await send(`/api/events/${id}/status`, "POST", { status: "open" }, cookie);
    const res = await send(`/api/public/events/${id}/votes`, "POST", { categoryId: { x: 1 }, entryId: 5, turnstileToken: "t" });
    expect(res.status).toBe(400);
  });
});

describe("Turnstile binding", () => {
  const answer = (body: object) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body)));

  it("in production, only accepts tokens solved on this site", async () => {
    answer({ success: true, hostname: "cookoffchamps.com" });
    expect(await verifyTurnstile(PROD, "tok", null)).toBe(true);
    vi.restoreAllMocks();
    answer({ success: true, hostname: "evil.example" });
    expect(await verifyTurnstile(PROD, "tok", null)).toBe(false);
    vi.restoreAllMocks();
    answer({ success: true });
    expect(await verifyTurnstile(PROD, "tok", null)).toBe(false);
  });

  it("in local dev, accepts the test keys' placeholder host", async () => {
    answer({ success: true, hostname: "example.com" });
    expect(await verifyTurnstile(env, "tok", null)).toBe(true);
  });
});
