import { api, ApiError } from "../api";
import type { Ctx } from "../app";
import { dateEl, h, logo, mount } from "../dom";
import type { EventSummary } from "../types";

const STATUS_LABEL: Record<string, string> = {
  setup: "Setting up",
  open: "Voting open",
  closed: "Voting closed",
  revealed: "Results out",
};

function codeForm(ctx: Ctx): HTMLElement {
  const input = h("input", {
    name: "code",
    class: "code-input",
    placeholder: "e.g. K7QM2X",
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: "false",
    required: true,
    maxlength: 6,
  }) as HTMLInputElement;
  return h(
    "form",
    {
      class: "card feature",
      onsubmit: (e: Event) => {
        e.preventDefault();
        ctx.navigate(`/c/${encodeURIComponent(input.value.trim().toUpperCase())}`);
      },
    },
    h("h2", {}, "Here to vote?"),
    h("label", {}, "Type the code from the poster ", input),
    h("button", { type: "submit" }, "Go"),
  );
}

function loginForm(ctx: Ctx): HTMLElement {
  const email = h("input", { type: "email", name: "email", required: true, autocomplete: "email" }) as HTMLInputElement;
  const status = h("p", { class: "status", role: "status" });
  const form = h(
    "form",
    {
      class: "card",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        status.textContent = "Sending…";
        try {
          await api("/api/auth/login", { method: "POST", body: { email: email.value } });
          status.textContent = `Check ${email.value} for your login link. It works once and expires in 15 minutes.`;
        } catch (err) {
          status.textContent = err instanceof ApiError ? err.message : "Couldn't send the link. Try again.";
        }
      },
    },
    h("h2", {}, "Running a cookoff?"),
    h("p", {}, "Log in with your email. We'll send you a link, so there's no password."),
    ctx.url.searchParams.get("login") === "expired" ? h("p", { class: "error" }, "That login link has expired or was already used. Send yourself a new one.") : null,
    h("label", {}, "Email ", email),
    h("button", { type: "submit" }, "Email me a link"),
    status,
  );
  return form;
}

function createForm(ctx: Ctx): HTMLElement {
  const name = h("input", { name: "name", required: true, maxlength: 120, placeholder: "Bailey Family Chili Cookoff" }) as HTMLInputElement;
  const date = h("input", { name: "date", type: "date" }) as HTMLInputElement;
  const status = h("p", { class: "status", role: "status" });
  return h(
    "form",
    {
      class: "card",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        try {
          const { id } = await api<{ id: string }>("/api/events", { method: "POST", body: { name: name.value, date: date.value } });
          ctx.navigate(`/e/${id}`);
        } catch (err) {
          status.textContent = (err as Error).message;
        }
      },
    },
    h("h2", {}, "New cookoff"),
    h("label", {}, "Name ", name),
    h("label", {}, "Date ", date),
    h("button", { type: "submit" }, "Create"),
    status,
  );
}

/** The brand, big on the guest's landing page and smaller once logged in. */
function hero(compact: boolean): HTMLElement {
  return h(
    "header",
    { class: compact ? "hero compact" : "hero" },
    logo(),
    h("h1", {}, "Cookoff Champs"),
    h("p", { class: "tagline" }, "Blind tasting, honest votes, and winners revealed 3rd to 1st."),
  );
}

export async function homeView(ctx: Ctx): Promise<void> {
  let email: string | null = null;
  try {
    email = (await api<{ email: string }>("/api/me")).email;
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) throw err;
  }

  if (!email) {
    mount(ctx.root, hero(false), codeForm(ctx), loginForm(ctx));
    return;
  }

  const { events } = await api<{ events: (EventSummary & { role: string })[] }>("/api/events");
  const logout = h("button", {
    class: "link",
    onclick: async () => {
      await api("/api/auth/logout", { method: "POST" });
      ctx.navigate("/");
    },
  }, "Log out");

  mount(
    ctx.root,
    hero(true),
    h("p", { class: "muted" }, `Logged in as ${email} `, logout),
    createForm(ctx),
    h("h2", {}, "Your cookoffs"),
    events.length
      ? h(
          "ul",
          { class: "events" },
          ...events.map((ev) =>
            h(
              "li",
              {},
              h("a", { href: `/e/${ev.id}`, "data-link": true }, ev.name),
              " ",
              h(
                "span",
                { class: "muted" },
                ev.date ? dateEl(ev.date) : null,
                ev.date ? " · " : null,
                [STATUS_LABEL[ev.status], ev.role === "co" ? "co-organizer" : null].filter(Boolean).join(" · "),
              ),
            ),
          ),
        )
      : h("p", { class: "muted" }, "None yet. Create one above."),
    codeForm(ctx),
  );
}

/** /c/:code, the typed fallback for the QR code. */
export async function codeView(ctx: Ctx, code: string): Promise<void> {
  try {
    const { id } = await api<{ id: string }>(`/api/public/codes/${encodeURIComponent(code)}`);
    ctx.navigate(`/v/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      mount(ctx.root, h("h1", {}, "Cookoff Champs"), h("p", { class: "error" }, err.message), codeForm(ctx));
      return;
    }
    if (!(err instanceof ApiError && err.status === 404)) throw err;
    mount(ctx.root, h("h1", {}, "No such code"), h("p", {}, `We couldn't find a cookoff with the code ${code}. Check the poster and try again.`), codeForm(ctx));
  }
}
