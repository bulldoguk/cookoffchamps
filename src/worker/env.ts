export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  /** "log" keeps emails in the dev outbox; "cloudflare" sends through EMAIL. */
  EMAIL_MODE: "log" | "cloudflare";
  /** Where links in emails point, e.g. https://cookoffchamps.com */
  APP_ORIGIN: string;
  /** The sending address, on a domain with Cloudflare Email Sending enabled. */
  EMAIL_FROM: string;
  /** Cloudflare Email Sending binding; absent in local dev. */
  EMAIL?: SendEmail;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET: string;
}
