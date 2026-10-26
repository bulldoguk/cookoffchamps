// Small but structurally real JPEG, PNG and WebP files for the photo tests. The
// pixels are nonsense (nothing decodes them); the containers are right, and the
// metadata a phone would add is planted where a phone puts it (SW-28).

const text = (s: string) => [...new TextEncoder().encode(s)];
const be16 = (n: number) => [n >> 8, n & 0xff];
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];

/** Text a stripped file must never contain. */
export const SECRETS = ["GPS 29.6966 -96.7783", "Pixel 9 Pro", "106 E South St", "HIDDEN TRAILER"];

const segment = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];

export interface JpegOptions {
  metadata?: boolean; // EXIF (GPS, phone), XMP, IPTC and a comment
  progressive?: boolean; // two scans with a table between them
  pad?: number; // extra compressed-data bytes
  fill?: boolean; // optional 0xFF padding before a marker, which stripping drops
}

/** The compressed data of a scan: a stuffed 0xFF and a restart marker included. */
export const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78];

export function jpegBytes({ metadata = false, progressive = false, pad = 0, fill = false }: JpegOptions = {}): Uint8Array {
  const sos = segment(0xda, [1, 1, 0, 0, 0x3f, 0]);
  const scan = [...SCAN, ...new Array(pad).fill(0)];
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, [...text("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(metadata ? segment(0xe1, [...text("Exif\0\0"), ...text(SECRETS[0]!), ...text(SECRETS[1]!)]) : []),
    ...(metadata ? segment(0xe1, text(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${SECRETS[2]}</x:xmpmeta>`)) : []),
    ...(metadata ? segment(0xed, text(`Photoshop 3.0\0${SECRETS[2]}`)) : []),
    ...segment(0xe2, [...text("ICC_PROFILE\0"), 1, 1, ...text("colour")]),
    ...(metadata ? segment(0xfe, text(`Shot at ${SECRETS[2]}`)) : []),
    ...(fill ? [0xff, 0xff] : []),
    ...segment(0xdb, [0, ...new Array(64).fill(1)]),
    ...segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    ...sos,
    ...scan,
    ...(progressive ? [...segment(0xc4, [0, 0]), ...sos, ...SCAN] : []),
    0xff, 0xd9,
    ...(metadata ? text(SECRETS[3]!) : []),
  ]);
}

const pngChunk = (kind: string, data: number[]) => [...be32(data.length), ...text(kind), ...data, 0, 0, 0, 0];

export function pngBytes({ metadata = false, pad = 0 } = {}): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...(metadata ? pngChunk("eXIf", text(SECRETS[0]!)) : []),
    ...(metadata ? pngChunk("tEXt", text(`Author\0${SECRETS[1]}`)) : []),
    ...(metadata ? pngChunk("zTXt", text(`Comment\0\0${SECRETS[2]}`)) : []),
    ...(metadata ? pngChunk("iTXt", text(`Place\0\0\0\0\0${SECRETS[2]}`)) : []),
    ...(metadata ? pngChunk("tIME", [7, 234, 10, 26, 12, 0, 0]) : []),
    ...pngChunk("sRGB", [0]),
    ...pngChunk("IDAT", [1, 2, 3, ...new Array(pad).fill(0)]),
    ...pngChunk("IEND", []),
    ...(metadata ? text(SECRETS[3]!) : []),
  ]);
}

const riffChunk = (kind: string, data: number[]) => [...text(kind), ...le32(data.length), ...data, ...(data.length % 2 ? [0] : [])];

/** VP8X flags: 0x08 says there's EXIF, 0x04 XMP, 0x10 an alpha channel. */
export function webpBytes({ metadata = false, pad = 0 } = {}): Uint8Array {
  const flags = 0x10 | (metadata ? 0x0c : 0);
  const chunks = [
    ...riffChunk("VP8X", [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...riffChunk("VP8 ", [9, 8, 7, ...new Array(pad).fill(0)]), // odd length: padded
    ...(metadata ? riffChunk("EXIF", text(SECRETS[0]!)) : []),
    ...(metadata ? riffChunk("XMP ", text(SECRETS[2]!)) : []),
  ];
  return new Uint8Array([...text("RIFF"), ...le32(chunks.length + 4), ...text("WEBP"), ...chunks, ...(metadata ? text(SECRETS[3]!) : [])]);
}

/** Whether `needle` appears anywhere in `bytes`. */
export function contains(bytes: Uint8Array, needle: string | number[]): boolean {
  const n = typeof needle === "string" ? text(needle) : needle;
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}
