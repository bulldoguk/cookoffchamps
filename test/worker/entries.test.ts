import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES } from "../../src/worker/photos";
import { call, jpeg, login, makeEntry, makeEvent, send } from "./helpers";

function form(fields: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("entries", () => {
  it("numbers entries within each category", async () => {
    const cookie = await login("ent@example.com");
    const { id, categoryId } = await makeEvent(cookie);
    expect((await makeEntry(cookie, categoryId, "A", "One")).number).toBe(1);
    expect((await makeEntry(cookie, categoryId, "B", "Two")).number).toBe(2);
    const { id: dessert } = await (await send(`/api/events/${id}/categories`, "POST", { name: "Dessert" }, cookie)).json<{ id: string }>();
    expect((await makeEntry(cookie, dessert, "C", "Pie")).number).toBe(1);

    const manage = await (await call(`/api/events/${id}`, { cookie })).json<{ entries: unknown[] }>();
    expect(manage.entries).toEqual([
      expect.objectContaining({ categoryId, number: 1, cookName: "A", dishName: "One", photoKey: null }),
      expect.objectContaining({ categoryId, number: 2, cookName: "B", dishName: "Two" }),
      expect.objectContaining({ categoryId: dessert, number: 1, cookName: "C", dishName: "Pie" }),
    ]);
  });

  it("stores the photo in R2 and serves it publicly with a long cache", async () => {
    const cookie = await login("pic@example.com");
    const { id, categoryId } = await makeEvent(cookie);
    const entry = await makeEntry(cookie, categoryId, "A", "One", jpeg(20));
    expect(entry.photoKey).toMatch(new RegExp(`^events/${id}/${entry.id}-`));

    const photo = await call(`/api/photos/${entry.photoKey}`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await photo.arrayBuffer()).byteLength).toBe(20);

    expect((await call(`/api/photos/events/${id}/missing`)).status).toBe(404);
    expect((await call(`/api/photos/other/thing`)).status).toBe(404);
    expect((await call(`/api/photos/`)).status).toBe(404);
  });

  it("serves repeat photo loads from the edge cache, not R2", async () => {
    await env.PHOTOS.put("events/x/cached", "first", { httpMetadata: { contentType: "image/jpeg" } });
    const body = async (res: Response) => new TextDecoder().decode(await res.arrayBuffer());
    expect(await body(await call("/api/photos/events/x/cached"))).toBe("first");
    // Overwriting the object directly proves the second load never reached R2.
    await env.PHOTOS.put("events/x/cached", "second");
    const again = await call("/api/photos/events/x/cached");
    expect(await body(again)).toBe("first");
    expect(again.headers.get("content-type")).toBe("image/jpeg");
  });

  it("serves a photo stored without a content type as octet-stream", async () => {
    await env.PHOTOS.put("events/x/bare", "x");
    const res = await call("/api/photos/events/x/bare");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("rejects non-images, oversized photos, missing fields and non-form bodies", async () => {
    const cookie = await login("bad@example.com");
    const { categoryId } = await makeEvent(cookie);
    const post = (body: BodyInit) => call(`/api/categories/${categoryId}/entries`, { method: "POST", cookie, body });

    expect((await post(form({ cookName: "A", dishName: "B", photo: jpeg(5, "image/gif") }))).status).toBe(415);
    expect((await post(form({ cookName: "A", dishName: "B", photo: jpeg(MAX_PHOTO_BYTES + 1) }))).status).toBe(413);
    expect((await post(form({ dishName: "B" }))).status).toBe(400);
    expect((await post(form({ cookName: "A", dishName: "" }))).status).toBe(400);
    expect((await post("plain text")).status).toBe(400);
    // An empty file input counts as no photo.
    const ok = await (await post(form({ cookName: "A", dishName: "B", photo: jpeg(0) }))).json<{ photoKey: null }>();
    expect(ok.photoKey).toBeNull();
  });

  it("updates names and swaps the photo, deleting the old one", async () => {
    const cookie = await login("edit@example.com");
    const { categoryId } = await makeEvent(cookie);
    const entry = await makeEntry(cookie, categoryId, "A", "One", jpeg());

    const res = await call(`/api/entries/${entry.id}`, { method: "PATCH", cookie, body: form({ dishName: "Uno", photo: jpeg(8, "image/png") }) });
    const { photoKey } = await res.json<{ photoKey: string }>();
    expect(photoKey).not.toBe(entry.photoKey);
    expect(await env.PHOTOS.head(entry.photoKey!)).toBeNull();
    expect((await env.PHOTOS.head(photoKey))!.httpMetadata!.contentType).toBe("image/png");

    await call(`/api/entries/${entry.id}`, { method: "PATCH", cookie, body: form({ cookName: "Al" }) });
    const row = await env.DB.prepare("SELECT cook_name, dish_name, photo_key FROM entries WHERE id = ?").bind(entry.id).first();
    expect(row).toEqual({ cook_name: "Al", dish_name: "Uno", photo_key: photoKey });
  });

  it("adds a first photo to an entry that had none", async () => {
    const cookie = await login("first@example.com");
    const { categoryId } = await makeEvent(cookie);
    const entry = await makeEntry(cookie, categoryId);
    const res = await call(`/api/entries/${entry.id}`, { method: "PATCH", cookie, body: form({ photo: jpeg() }) });
    expect((await res.json<{ photoKey: string }>()).photoKey).toMatch(/^events\//);
  });

  it("deletes an entry with its photo, without renumbering the rest", async () => {
    const cookie = await login("gone@example.com");
    const { id, categoryId } = await makeEvent(cookie);
    const one = await makeEntry(cookie, categoryId, "A", "One", jpeg());
    const two = await makeEntry(cookie, categoryId, "B", "Two");
    expect((await call(`/api/entries/${one.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect(await env.PHOTOS.head(one.photoKey!)).toBeNull();
    expect((await call(`/api/entries/${two.id}`, { method: "DELETE", cookie })).status).toBe(200);
    const manage = await (await call(`/api/events/${id}`, { cookie })).json<{ entries: unknown[] }>();
    expect(manage.entries).toEqual([]);
  });

  it("checks the entry exists, belongs to the caller, and voting is still open", async () => {
    const cookie = await login("guard@example.com");
    const { id, categoryId } = await makeEvent(cookie);
    const entry = await makeEntry(cookie, categoryId);
    expect((await call(`/api/entries/nope`, { method: "DELETE", cookie })).status).toBe(404);
    const stranger = await login("guard-x@example.com");
    expect((await call(`/api/entries/${entry.id}`, { method: "DELETE", cookie: stranger })).status).toBe(403);
    expect((await call(`/api/categories/nope/entries`, { method: "POST", cookie, body: form({}) })).status).toBe(404);

    await send(`/api/events/${id}/status`, "POST", { status: "open" }, cookie);
    expect((await makeEntry(cookie, categoryId, "Late", "Arrival")).number).toBe(2);
    await send(`/api/events/${id}/status`, "POST", { status: "closed" }, cookie);
    expect((await call(`/api/categories/${categoryId}/entries`, { method: "POST", cookie, body: form({ cookName: "X", dishName: "Y" }) })).status).toBe(409);
    expect((await call(`/api/entries/${entry.id}`, { method: "PATCH", cookie, body: form({ cookName: "Z" }) })).status).toBe(409);
    expect((await call(`/api/entries/${entry.id}`, { method: "DELETE", cookie })).status).toBe(409);
  });
});
