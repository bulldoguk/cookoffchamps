import type { ErrorCode } from "../shared/errors";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ErrorCode, // for showing it in Spanish (SW-27)
  ) {
    super(message);
  }
}

/**
 * Calls the API. A plain object body is sent as JSON; FormData as-is. Non-2xx
 * responses throw ApiError carrying the server's message and error code.
 */
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = { method: options.method ?? "GET", credentials: "same-origin" };
  if (options.body instanceof FormData) {
    init.body = options.body;
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { "content-type": "application/json" };
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, code } = data as { error?: string; code?: ErrorCode };
    throw new ApiError(res.status, error ?? "Something went wrong", code);
  }
  return data as T;
}
