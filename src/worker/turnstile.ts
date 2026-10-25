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
  const outcome = await res.json<{ success?: boolean }>();
  return outcome.success === true;
}
