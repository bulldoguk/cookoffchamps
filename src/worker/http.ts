import type { ErrorCode } from "../shared/errors";

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/** An error response. `code` lets the app say it in the reader's language (SW-27). */
export function error(status: number, message: string, code?: ErrorCode): Response {
  return json(code ? { error: message, code } : { error: message }, status);
}

/** Thrown by handlers to end a request with an error response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ErrorCode,
  ) {
    super(message);
  }
}

/** Parses a JSON body that must be an object; anything else is a 400. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/** A required, trimmed, non-empty string of at most `max` characters. */
export function requireText(value: unknown, field: string, max = 120): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field} is required`, "required");
  }
  const text = value.trim();
  if (text.length > max) throw new HttpError(400, `${field} is too long`, "tooLong");
  return text;
}

/** An optional YYYY-MM-DD date; empty or missing becomes null. */
export function optionalDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "date must be YYYY-MM-DD", "badDate");
  }
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireEmail(value: unknown): string {
  if (typeof value !== "string" || !EMAIL_RE.test(value.trim()) || value.length > 254) {
    throw new HttpError(400, "A valid email address is required", "badEmail");
  }
  return value.trim().toLowerCase();
}
