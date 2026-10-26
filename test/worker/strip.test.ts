import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { HttpError } from "../../src/worker/http";
import { stripMetadata } from "../../src/worker/strip";
import { login, makeEntry, makeEvent } from "./helpers";
import { contains, jpegBytes, pngBytes, SCAN, SECRETS, webpBytes } from "./images";

const noSecrets = (bytes: Uint8Array) => SECRETS.filter((s) => contains(bytes, s));

function refused(bytes: number[] | Uint8Array, type: string) {
  try {
    stripMetadata(new Uint8Array(bytes), type);
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(415);
    return true;
  }
  return false;
}

describe("stripping JPEG metadata", () => {
  it("removes EXIF, XMP, IPTC, comments and anything after the image", () => {
    const dirty = jpegBytes({ metadata: true, fill: true });
    expect(noSecrets(dirty)).toHaveLength(SECRETS.length);
    const clean = stripMetadata(dirty, "image/jpeg");
    expect(noSecrets(clean)).toEqual([]);
    expect(clean).toEqual(jpegBytes()); // exactly the file without the metadata
  });

  it("keeps the JFIF header, the colour profile, tables and the compressed data", () => {
    const clean = stripMetadata(jpegBytes({ metadata: true }), "image/jpeg");
    expect(contains(clean, "JFIF")).toBe(true);
    expect(contains(clean, "ICC_PROFILE")).toBe(true);
    expect(contains(clean, SCAN)).toBe(true); // a stuffed 0xFF and a restart marker don't end the scan
    expect([...clean.subarray(-2)]).toEqual([0xff, 0xd9]);
  });

  it("handles progressive files, with tables between scans", () => {
    expect(stripMetadata(jpegBytes({ metadata: true, progressive: true, fill: true }), "image/jpeg")).toEqual(jpegBytes({ progressive: true }));
  });

  it("refuses files it can't follow", () => {
    const good = [...jpegBytes()];
    expect(refused([0x00, 0xd8, 0xff], "image/jpeg")).toBe(true); // not a JPEG start
    expect(refused([0xff, 0xd8, 0x00, 0x00], "image/jpeg")).toBe(true); // junk where a marker should be
    expect(refused([0xff, 0xd8, 0xff], "image/jpeg")).toBe(true); // ends on a marker byte
    expect(refused([0xff, 0xd8, 0xff, 0xe0, 0x00], "image/jpeg")).toBe(true); // no room for a length
    expect(refused([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 1, 2], "image/jpeg")).toBe(true); // length past the end
    expect(refused(good.slice(0, -2), "image/jpeg")).toBe(true); // scan never ends
  });
});

describe("stripping PNG metadata", () => {
  it("removes eXIf, text and time chunks and anything after IEND, keeping the image", () => {
    const clean = stripMetadata(pngBytes({ metadata: true }), "image/png");
    expect(noSecrets(clean)).toEqual([]);
    expect(clean).toEqual(pngBytes());
    for (const kind of ["IHDR", "sRGB", "IDAT", "IEND"]) expect(contains(clean, kind)).toBe(true);
    for (const kind of ["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]) expect(contains(clean, kind)).toBe(false);
  });

  it("refuses truncated files", () => {
    const good = [...pngBytes()];
    expect(refused(good.slice(0, 12), "image/png")).toBe(true); // no room for a chunk
    expect(refused([...good.slice(0, 8), 0, 0, 1, 0, ...good.slice(12, 40)], "image/png")).toBe(true); // chunk length past the end
    expect(refused(good.slice(0, -12), "image/png")).toBe(true); // no IEND
  });
});

describe("stripping WebP metadata", () => {
  it("removes EXIF and XMP chunks, clears their flags and fixes the size", () => {
    const clean = stripMetadata(webpBytes({ metadata: true }), "image/webp");
    expect(noSecrets(clean)).toEqual([]);
    expect(clean).toEqual(webpBytes()); // flags back to alpha only, RIFF size recomputed
    const view = new DataView(clean.buffer, clean.byteOffset);
    expect(view.getUint32(4, true)).toBe(clean.length - 8);
  });

  it("keeps a file with no metadata as it was", () => {
    expect(stripMetadata(webpBytes(), "image/webp")).toEqual(webpBytes());
  });

  it("refuses files whose sizes don't add up", () => {
    const good = [...webpBytes()];
    expect(refused(good.slice(0, 10), "image/webp")).toBe(true); // shorter than the header
    expect(refused([...good.slice(0, 4), 0xff, 0xff, 0, 0, ...good.slice(8)], "image/webp")).toBe(true); // RIFF size past the end
    const lie = [...good];
    lie[16] = 0xff; // the VP8X chunk claims 255 bytes
    expect(refused(lie, "image/webp")).toBe(true);
    const ragged = [...good.slice(0, 12 + 18), 1, 2, 3]; // VP8X then 3 stray bytes
    ragged.splice(4, 4, ...[ragged.length - 8, 0, 0, 0]);
    expect(refused(ragged, "image/webp")).toBe(true);
  });
});

describe("uploads", () => {
  it("stores photos without their metadata", async () => {
    const cookie = await login("strip@example.com");
    const { categoryId } = await makeEvent(cookie);
    for (const [type, dirty] of [
      ["image/jpeg", jpegBytes({ metadata: true })],
      ["image/png", pngBytes({ metadata: true })],
      ["image/webp", webpBytes({ metadata: true })],
    ] as const) {
      const entry = await makeEntry(cookie, categoryId, "A", "B", new File([dirty], "dish", { type }));
      const stored = new Uint8Array(await (await env.PHOTOS.get(entry.photoKey!))!.arrayBuffer());
      expect(noSecrets(stored), type).toEqual([]);
    }
  });
});
