// Cloudflare Turnstile: an invisible check on each vote that keeps scripts out
// without asking a real guest to do anything (spec stack). Tokens are single-use,
// so every vote asks for a fresh one.

import { m } from "./i18n";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve(window.turnstile!);
    script.onerror = () => {
      loading = null;
      reject(new Error(m().vote.loadFailed));
    };
    document.head.append(script);
  });
  return loading;
}

export async function getTurnstileToken(siteKey: string, container: HTMLElement): Promise<string> {
  const turnstile = await loadTurnstile();
  return new Promise((resolve, reject) => {
    const id = turnstile.render(container, {
      sitekey: siteKey,
      execution: "execute",
      appearance: "interaction-only",
      callback: (token: string) => {
        turnstile.remove(id);
        resolve(token);
      },
      "error-callback": () => {
        turnstile.remove(id);
        reject(new Error(m().vote.checkFailed));
      },
    });
    turnstile.execute(id);
  });
}

/** For tests: forget a half-finished script load. */
export function resetTurnstileLoader(): void {
  loading = null;
}
