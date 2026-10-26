import type { Env } from "./env";
import { HttpError } from "./http";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

// Production sends through Resend's free plan (spec decision 3). Cloudflare Email
// Sending was tried on 2026-10-24 and dropped: it needs the $5/month Workers Paid
// plan. In "log" mode the message lands in the dev outbox instead.
export async function sendEmail(env: Env, email: Email): Promise<void> {
  if (env.EMAIL_MODE === "log") {
    await env.DB.prepare(
      "INSERT INTO dev_outbox (to_addr, subject, body, sent_at) VALUES (?, ?, ?, ?)",
    )
      .bind(email.to, email.subject, email.text, new Date().toISOString())
      .run();
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `Cookoff Champs <${env.EMAIL_FROM}>`,
      to: [email.to],
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!res.ok) {
    console.error("email send failed", res.status, await res.text());
    throw new HttpError(502, "Could not send email", "emailFailed");
  }
}

/**
 * The dev outbox, newest first. Only on a localhost origin in log mode, so a
 * production deploy can never expose login links even if misconfigured.
 */
export async function readOutbox(env: Env): Promise<Response | null> {
  if (env.EMAIL_MODE !== "log" || !env.APP_ORIGIN.startsWith("http://localhost")) {
    return null;
  }
  const { results } = await env.DB.prepare(
    "SELECT to_addr AS 'to', subject, body FROM dev_outbox ORDER BY id DESC LIMIT 20",
  ).all();
  return Response.json(results);
}
