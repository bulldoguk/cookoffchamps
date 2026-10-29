// Response hardening and the cross-site request check (SW-19). Every response,
// static assets included, passes through the Worker (run_worker_first), so the
// headers are set here: a public/_headers file is not applied to responses that
// Worker code returns, and this way one place covers assets and API alike.

import type { Env } from "./env";

// Two third parties: Turnstile (its script and its iframe) and the Cloudflare
// Web Analytics beacon script (SW-60), which Cloudflare injects at the edge and
// which reports to our own /cdn-cgi/rum, so connect-src stays 'self'. The whole
// host is allowed: the beacon loads from a versioned path under beacon.min.js/,
// which the documented exact-file source would block. Inline
// styles stay allowed because the views may set style attributes; scripts may not.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const BASE_HEADERS: Record<string, string> = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  // Event links are the key to an event (decision 13), so they never leave the
  // site in a Referer header; other sites see only the origin.
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
};

const HSTS = "max-age=31536000; includeSubDomains";

/** Adds the security headers; API responses also default to no-store. */
export function withSecurityHeaders(response: Response, env: Env, isApi: boolean): Response {
  const secured = new Response(response.body, response);
  // A handler's own, stricter header (the photo CSP) wins over the site default.
  for (const [name, value] of Object.entries(BASE_HEADERS)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  if (env.APP_ORIGIN.startsWith("https://")) secured.headers.set("strict-transport-security", HSTS);
  if (isApi && !secured.headers.has("cache-control")) secured.headers.set("cache-control", "no-store");
  return secured;
}

/**
 * The canonical URL for a request: www goes to the apex, and plain http to https
 * when the site itself is served over https. Null when the request is already there.
 */
export function canonicalRedirect(url: URL, env: Env): string | null {
  const target = new URL(url);
  if (target.hostname.startsWith("www.")) target.hostname = target.hostname.slice(4);
  if (target.protocol === "http:" && env.APP_ORIGIN.startsWith("https://")) target.protocol = "https:";
  return target.href === url.href ? null : target.href;
}

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

/**
 * True when a state-changing request came from another site. Browsers always
 * send Origin on cross-site POST/PATCH/DELETE, so one that isn't this site's own
 * origin is refused; tools like curl send none and are let through (they carry
 * no victim's cookies). The comparison is with the request's own origin, since
 * www and http were already redirected, and `wrangler dev` rewrites both the URL
 * and the Origin header to the route's host.
 */
export function isCrossSite(request: Request): boolean {
  if (SAFE_METHODS.includes(request.method)) return false;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}
