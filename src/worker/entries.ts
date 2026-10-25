import { categoryEvent, entryEvent, requireEditable } from "./access";
import { requireSession } from "./auth";
import type { Env } from "./env";
import { HttpError, json, requireText } from "./http";
import { newId } from "./ids";
import { checkPhoto, putPhoto } from "./photos";

// The organizer adds every entry, usually at the table (decision 10): cook,
// dish and photo, sent as multipart form data so the photo rides along.

async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, "Send the entry as form data");
  }
}

function photoFrom(form: FormData): File | null {
  const value = form.get("photo");
  if (!(value instanceof File) || value.size === 0) return null;
  checkPhoto(value);
  return value;
}

/** POST /api/categories/:id/entries (form: cookName, dishName, photo?) */
export async function addEntry(request: Request, env: Env, categoryId: string): Promise<Response> {
  const email = await requireSession(request, env);
  const { event } = await categoryEvent(env, categoryId, email);
  requireEditable(event);
  const form = await readForm(request);
  const cookName = requireText(form.get("cookName"), "cookName", 80);
  const dishName = requireText(form.get("dishName"), "dishName", 80);
  const photo = photoFrom(form);

  const id = newId();
  const photoKey = photo ? await putPhoto(env, event.id, id, photo) : null;
  // Numbers run on within the category: "Entry 3" matches tent card 3 (decision 11).
  const row = await env.DB.prepare(
    `INSERT INTO entries (id, category_id, number, cook_name, dish_name, photo_key)
     VALUES (?, ?, (SELECT COALESCE(MAX(number), 0) + 1 FROM entries WHERE category_id = ?), ?, ?, ?)
     RETURNING number`,
  )
    .bind(id, categoryId, categoryId, cookName, dishName, photoKey)
    .first<{ number: number }>();
  return json({ id, number: row!.number, photoKey }, 201);
}

/** PATCH /api/entries/:id (form: cookName?, dishName?, photo?) */
export async function updateEntry(request: Request, env: Env, entryId: string): Promise<Response> {
  const email = await requireSession(request, env);
  const { event } = await entryEvent(env, entryId, email);
  requireEditable(event);
  const form = await readForm(request);
  const current = await env.DB.prepare("SELECT cook_name, dish_name, photo_key FROM entries WHERE id = ?")
    .bind(entryId)
    .first<{ cook_name: string; dish_name: string; photo_key: string | null }>();

  const cookName = form.has("cookName") ? requireText(form.get("cookName"), "cookName", 80) : current!.cook_name;
  const dishName = form.has("dishName") ? requireText(form.get("dishName"), "dishName", 80) : current!.dish_name;
  const photo = photoFrom(form);
  let photoKey = current!.photo_key;
  if (photo) {
    photoKey = await putPhoto(env, event.id, entryId, photo);
    if (current!.photo_key) await env.PHOTOS.delete(current!.photo_key);
  }

  await env.DB.prepare("UPDATE entries SET cook_name = ?, dish_name = ?, photo_key = ? WHERE id = ?")
    .bind(cookName, dishName, photoKey, entryId)
    .run();
  return json({ ok: true, photoKey });
}

/** DELETE /api/entries/:id — its votes go with it. Numbers are not reshuffled, so printed cards stay right. */
export async function deleteEntry(request: Request, env: Env, entryId: string): Promise<Response> {
  const email = await requireSession(request, env);
  const { event } = await entryEvent(env, entryId, email);
  requireEditable(event);
  const row = await env.DB.prepare("DELETE FROM entries WHERE id = ? RETURNING photo_key")
    .bind(entryId)
    .first<{ photo_key: string | null }>();
  if (row!.photo_key) await env.PHOTOS.delete(row!.photo_key);
  return json({ ok: true });
}
