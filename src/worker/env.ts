export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  /** "log" keeps emails in the dev outbox instead of sending them. */
  EMAIL_MODE: "log" | "resend";
  /** Where links in emails point, e.g. https://cookoffchamps.com */
  APP_ORIGIN: string;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET: string;
}
