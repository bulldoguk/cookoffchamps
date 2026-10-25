// Organizer login by magic link (spec decisions 2 and 3). Tokens and session
// ids are random; only their SHA-256 hashes are stored, so a database leak does
// not hand out working logins.

import { cookie, readCookie } from "./cookies";
import { sendEmail } from "./email";
import type { Env } from "./env";
import { HttpError, json, readJson, requireEmail } from "./http";
import { newId } from "./ids";

export const SESSION_COOKIE = "cc_session";
const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_S = 30 * 24 * 60 * 60;

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only same-site paths, so a crafted link can't bounce a login off-site. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Emails a single-use login link that lands on `next` once signed in. */
export async function sendLoginLink(
  env: Env,
  email: string,
  next: string,
  subject = "Your Cookoff Champs login link",
  intro = "Here's your link to log in to Cookoff Champs.",
): Promise<void> {
  const token = newId() + newId();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), email, new Date(Date.now() + LINK_TTL_MS).toISOString())
    .run();
  const link = `${env.APP_ORIGIN}/api/auth/verify?token=${token}&next=${encodeURIComponent(safeNext(next))}`;
  await sendEmail(env, {
    to: email,
    subject,
    text: `${intro}\n\n${link}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
  });
}

/** POST /api/auth/login {email, next?}. Always 200, so it can't be used to probe for accounts. */
export async function requestLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const email = requireEmail(body.email);
  await sendLoginLink(env, email, safeNext(typeof body.next === "string" ? body.next : null));
  return json({ ok: true });
}

/** GET /api/auth/verify?token=…&next=… — trades the link for a session cookie. */
export async function verifyLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const hash = await sha256(token);
  const now = new Date().toISOString();

  // Claim the token in one statement, so a link can't be used twice even by two
  // requests racing each other.
  const row = await env.DB.prepare(
    "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email",
  )
    .bind(now, hash, now)
    .first<{ email: string }>();

  if (!row) {
    return new Response(null, { status: 302, headers: { location: "/?login=expired" } });
  }

  const sessionId = newId() + newId();
  await env.DB.prepare("INSERT INTO sessions (id_hash, email, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(sessionId), row.email, new Date(Date.now() + SESSION_TTL_S * 1000).toISOString())
    .run();

  return new Response(null, {
    status: 302,
    headers: {
      location: safeNext(url.searchParams.get("next")),
      "set-cookie": cookie(SESSION_COOKIE, sessionId, SESSION_TTL_S),
    },
  });
}

/** The signed-in organizer's email, or null. */
export async function sessionEmail(request: Request, env: Env): Promise<string | null> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const row = await env.DB.prepare("SELECT email FROM sessions WHERE id_hash = ? AND expires_at > ?")
    .bind(await sha256(sessionId), new Date().toISOString())
    .first<{ email: string }>();
  return row?.email ?? null;
}

export async function requireSession(request: Request, env: Env): Promise<string> {
  const email = await sessionEmail(request, env);
  if (!email) throw new HttpError(401, "Please log in");
  return email;
}

/** POST /api/auth/logout */
export async function logout(request: Request, env: Env): Promise<Response> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (sessionId) {
    await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(sessionId)).run();
  }
  return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", 0) });
}

/** GET /api/me */
export async function me(request: Request, env: Env): Promise<Response> {
  return json({ email: await requireSession(request, env) });
}
