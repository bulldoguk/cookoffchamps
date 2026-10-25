import type { Env } from "./env";
import { HttpError } from "./http";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Checks an uploaded photo. The phone shrinks photos before upload (decision 10),
 * so anything near the limit means the resize was skipped.
 */
export function checkPhoto(file: File): void {
  if (!PHOTO_TYPES.includes(file.type)) throw new HttpError(415, "Photos must be JPEG, PNG or WebP");
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError(413, "That photo is too large");
}

/**
 * Stores a photo under a new key each time, so a replaced photo gets a new URL
 * and the year-long cache on the old one can never serve stale.
 */
export async function putPhoto(env: Env, eventId: string, entryId: string, file: File): Promise<string> {
  const key = `events/${eventId}/${entryId}-${crypto.randomUUID()}`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}

/**
 * GET /api/photos/<key> — public, like the event page itself.
 *
 * Served from the edge cache when it can be, so a room full of phones loading the
 * same dishes costs one R2 read per photo per data centre, not one per phone. Keys
 * never repeat, so a cached copy can't go stale; a deleted photo may linger at the
 * edge, but only under a URL nothing links to any more.
 */
export async function getPhoto(env: Env, key: string, request: Request): Promise<Response> {
  if (!key.startsWith("events/")) throw new HttpError(404, "Not found");
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const object = await env.PHOTOS.get(key);
  if (!object) throw new HttpError(404, "Not found");
  const response = new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
  await cache.put(request, response.clone());
  return response;
}

export async function deletePhotoPrefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.PHOTOS.list({ prefix, cursor });
    if (page.objects.length) await env.PHOTOS.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
