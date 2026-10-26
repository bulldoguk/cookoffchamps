import { ApiError } from "../api";
import { en, type Messages } from "./en";
import { es, esErrors } from "./es";

// The app's language (SW-27). A guest's phone decides at first, and the
// English / Español switch overrides it and is remembered on that browser. An
// organizer's choice is the same switch; it also sets the language of the
// emails they ask for (see src/worker/i18n.ts).

export type Lang = "en" | "es";

const MESSAGES: Record<Lang, Messages> = { en, es };
const STORE_KEY = "cc_lang";

let current: Lang = "en";

function isLang(value: unknown): value is Lang {
  return value === "en" || value === "es";
}

function stored(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null; // storage blocked (private mode, cookies off): the phone decides
  }
}

/** ?lang= in the address (the help pages link with it), then the saved choice, then the phone. */
export function detectLang(url: URL, navLang: string): Lang {
  const asked = url.searchParams.get("lang");
  if (isLang(asked)) return asked;
  const saved = stored();
  if (isLang(saved)) return saved;
  return navLang.toLowerCase().startsWith("es") ? "es" : "en";
}

export function lang(): Lang {
  return current;
}

/** Switches the app's language, remembers it, and sets <html lang>. */
export function setLang(next: Lang, remember = true): void {
  current = next;
  document.documentElement.lang = next;
  if (!remember) return;
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch {
    // Not saved: the switch still works until the page is closed.
  }
}

/** The current language's words. Views call it as they draw, so a switch redraws in the new language. */
export function m(): Messages {
  return MESSAGES[current];
}

/** The other language, for the switch. */
export function otherLang(): Lang {
  return current === "en" ? "es" : "en";
}

/** A language's name in that language: "English", "Español". */
export function langName(l: Lang): string {
  return MESSAGES[l].name;
}

/**
 * The locale for dates: the phone's own when it speaks the app's language (so
 * en-GB keeps day-month order), otherwise the language's default.
 */
export function dateLocale(navLang: string = navigator.language): string {
  return navLang.toLowerCase().startsWith(current) ? navLang : m().locale;
}

/**
 * An error as the person should read it. The server's errors carry a code; in
 * Spanish the code picks the words, and in English the server's message is used
 * as is. Anything without a known code gets a general message in Spanish.
 */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (current === "en") return err.message;
    return (err.code && esErrors[err.code]) || m().app.generic;
  }
  return err instanceof Error ? err.message : m().app.generic;
}
