export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  EMAIL_MODE: "log" | "resend";
  APP_ORIGIN: string;
}
