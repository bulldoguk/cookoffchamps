import type { Env } from "./env";

/**
 * Checks a Turnstile token with Cloudflare. It keeps scripted ballot stuffing
 * out without asking a real guest to do anything. Tokens are single-use.
 */
export async function verifyTurnstile(env: Env, token: unknown, ip: string | null): Promise<boolean> {
  if (typeof token !== "string" || token === "") return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!res.ok) return false;
  const outcome = await res.json<{ success?: boolean; hostname?: string }>();
  if (outcome.success !== true) return false;
  // A token solved on another site that uses the same key doesn't count. Local
  // dev runs Cloudflare's test keys, whose tokens name a placeholder host.
  const expected = new URL(env.APP_ORIGIN).hostname;
  return expected === "localhost" || outcome.hostname === expected;
}
