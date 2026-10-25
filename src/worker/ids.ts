// Event links must be unguessable (decision 13); the typed code only has to be
// short and unambiguous to read off a poster.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

/** 128 random bits as URL-safe base64 (22 characters). */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** A short code for typing in by hand, e.g. "K7QM2X". */
export function newCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  // 256 is not a multiple of 31, so a modulo is very slightly biased. That is
  // harmless here: the code is a convenience, not a secret.
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
