import { api } from "../api";
import type { Ctx } from "../app";
import { h, mount, photoUrl } from "../dom";
import { resizePhoto } from "../photo";
import type { ManageEntry, ManageView, Totals } from "../types";

export const POLL_MS = 10_000;
export const PEEK_MS = 20_000;

/** Builds the entry form body, shrinking the photo first (decision 10). */
export async function entryForm(fields: { cookName?: string; dishName?: string; photo?: File | null }): Promise<FormData> {
  const form = new FormData();
  if (fields.cookName !== undefined) form.set("cookName", fields.cookName);
  if (fields.dishName !== undefined) form.set("dishName", fields.dishName);
  if (fields.photo) form.set("photo", await resizePhoto(fields.photo), "dish.jpg");
  return form;
}

const STEPS: [string, string][] = [
  ["setup", "Set up"],
  ["open", "Voting"],
  ["closed", "Closed"],
  ["revealed", "Results"],
];

/** Where the event is in its life: set up → voting → closed → results. */
export function stepper(status: string): HTMLElement {
  const at = STEPS.findIndex(([s]) => s === status);
  return h(
    "ol",
    { class: "stepper" },
    ...STEPS.map(([, label], i) =>
      h("li", { class: i < at ? "done" : undefined, "aria-current": i === at ? "step" : undefined }, label),
    ),
  );
}

/** The organizer's screen: set up, run voting, peek, and get to print and reveal. */
export async function manageView(ctx: Ctx, eventId: string): Promise<() => void> {
  let data = await api<ManageView>(`/api/events/${eventId}`);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  const notice = h("p", { class: "status", role: "status" });

  async function reload(): Promise<void> {
    data = await api<ManageView>(`/api/events/${eventId}`);
    draw();
  }

  /** Runs an action, reloading after; failures show in the notice line. */
  async function act(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
      notice.textContent = "";
      await reload();
    } catch (err) {
      notice.textContent = (err as Error).message;
    }
  }

  function setStatus(status: string) {
    return act(() => api(`/api/events/${eventId}/status`, { method: "POST", body: { status } }));
  }

  function statusControls(): HTMLElement {
    const s = data.event.status;
    const box = h("section", { class: "card controls", "aria-label": "Event progress" }, stepper(s));
    if (s === "setup") {
      box.append(h("p", {}, "Add the dishes, print the poster, then open voting."), h("button", { onclick: () => setStatus("open") }, "Open voting"));
    } else if (s === "open") {
      box.append(h("p", { class: "live" }, "Voting is open."), h("button", { onclick: () => setStatus("closed") }, "Close voting"));
    } else if (s === "closed") {
      box.append(
        h("p", {}, "Voting is closed. Totals stay hidden from guests until the reveal."),
        h("a", { class: "button", href: `/e/${eventId}/reveal`, "data-link": true }, "Start the reveal"),
        h("button", { class: "secondary", onclick: () => setStatus("open") }, "Reopen voting"),
      );
    } else {
      box.append(h("p", {}, "The results are out."), h("a", { class: "button", href: `/v/${eventId}`, "data-link": true }, "See the results page"));
    }
    return box;
  }

  // The count, never the standings: it shows up ballot stuffing against the
  // number of guests (decision 5).
  const countEl = h("p", { class: "big", "data-testid": "votes-cast" });
  const perCategory = h("ul", { class: "per-category" });

  function drawCounts(): void {
    countEl.textContent = String(data.votesCast.reduce((n, c) => n + c.votes, 0));
    perCategory.hidden = data.categories.length < 2;
    perCategory.replaceChildren(
      ...data.categories.map((c) => h("li", {}, `${c.name}: ${data.votesCast.find((v) => v.categoryId === c.id)?.votes ?? 0}`)),
    );
  }

  function votesCast(): HTMLElement {
    drawCounts();
    return h("section", { class: "card" }, h("h2", {}, "Votes cast"), countEl, perCategory, peekSection());
  }

  /**
   * The live poll. It only touches the counts, so an open peek or a half-typed
   * entry survives; a status change (say, a co-organizer closed voting) redraws.
   */
  async function poll(): Promise<void> {
    const before = data.event.status;
    data = await api<ManageView>(`/api/events/${eventId}`);
    if (data.event.status === before) drawCounts();
    else draw();
  }

  function peekSection(): HTMLElement {
    // Behind a deliberate tap, and it hides itself again (decision 15).
    const panel = h("div", { class: "peek", hidden: true });
    const button = h("button", { class: "secondary" }, "Peek at the standings") as HTMLButtonElement;
    button.addEventListener("click", async () => {
      if (!panel.hidden) {
        panel.hidden = true;
        button.textContent = "Peek at the standings";
        return;
      }
      const { totals } = await api<Totals>(`/api/events/${eventId}/totals`);
      panel.replaceChildren(
        ...data.categories.map((c) => {
          const rows = totals.filter((t) => t.categoryId === c.id).sort((a, b) => b.votes - a.votes);
          return h(
            "div",
            {},
            data.categories.length > 1 ? h("h3", {}, c.name) : null,
            h("ol", {}, ...rows.map((t) => {
              const entry = data.entries.find((e) => e.id === t.entryId)!;
              return h("li", {}, `Entry ${entry.number}, ${entry.dishName} (${entry.cookName}): ${t.votes}`);
            })),
          );
        }),
      );
      panel.hidden = false;
      button.textContent = "Hide the standings";
      clearTimeout(peekTimer);
      peekTimer = setTimeout(() => {
        panel.hidden = true;
        button.textContent = "Peek at the standings";
      }, PEEK_MS);
    });
    return h("div", {}, button, panel);
  }

  function entryRow(entry: ManageEntry, editable: boolean): HTMLElement {
    const li = h(
      "li",
      { class: "entry" },
      entry.photoKey ? h("img", { src: photoUrl(entry.photoKey), alt: "", class: "thumb" }) : h("span", { class: "thumb none" }, "No photo"),
      h("span", {}, h("strong", {}, `Entry ${entry.number}`), ` ${entry.dishName} `, h("span", { class: "muted" }, `by ${entry.cookName}`)),
    );
    if (editable) {
      li.append(
        h("button", { class: "link", onclick: () => li.replaceWith(editEntryForm(entry)) }, "Edit"),
        h("button", {
          class: "link danger",
          onclick: () => {
            if (confirm(`Delete entry ${entry.number}, ${entry.dishName}?`)) void act(() => api(`/api/entries/${entry.id}`, { method: "DELETE" }));
          },
        }, "Delete"),
      );
    }
    return li;
  }

  function editEntryForm(entry: ManageEntry): HTMLElement {
    const cook = h("input", { name: "cookName", value: entry.cookName, required: true }) as HTMLInputElement;
    const dish = h("input", { name: "dishName", value: entry.dishName, required: true }) as HTMLInputElement;
    const photo = h("input", { name: "photo", type: "file", accept: "image/*" }) as HTMLInputElement;
    return h(
      "form",
      {
        class: "entry-form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          void act(async () =>
            api(`/api/entries/${entry.id}`, {
              method: "PATCH",
              body: await entryForm({ cookName: cook.value, dishName: dish.value, photo: photo.files?.[0] ?? null }),
            }),
          );
        },
      },
      h("label", {}, "Cook ", cook),
      h("label", {}, "Dish ", dish),
      h("label", {}, "New photo ", photo),
      h("button", { type: "submit" }, "Save"),
      h("button", { type: "button", class: "link", onclick: () => draw() }, "Cancel"),
    );
  }

  function addEntryForm(categoryId: string): HTMLElement {
    const cook = h("input", { name: "cookName", required: true, maxlength: 80 }) as HTMLInputElement;
    const dish = h("input", { name: "dishName", required: true, maxlength: 80 }) as HTMLInputElement;
    // capture opens the camera straight away on a phone.
    const photo = h("input", { name: "photo", type: "file", accept: "image/*", capture: "environment" }) as HTMLInputElement;
    return h(
      "form",
      {
        class: "entry-form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          notice.textContent = "Adding…";
          void act(async () =>
            api(`/api/categories/${categoryId}/entries`, {
              method: "POST",
              body: await entryForm({ cookName: cook.value, dishName: dish.value, photo: photo.files?.[0] ?? null }),
            }),
          );
        },
      },
      h("h3", {}, "Add a dish"),
      h("label", {}, "Cook ", cook),
      h("label", {}, "Dish ", dish),
      h("label", {}, "Photo ", photo),
      h("button", { type: "submit" }, "Add"),
    );
  }

  function categoriesSection(): HTMLElement {
    const editable = data.event.status === "setup" || data.event.status === "open";
    // A single contest shows no category headings at all (decision 12).
    const multi = data.categories.length > 1;
    const section = h("section", { class: "card" }, h("h2", {}, "Dishes"));
    for (const c of data.categories) {
      const entries = data.entries.filter((e) => e.categoryId === c.id);
      const block = h("div", { class: "category" });
      if (multi) {
        block.append(h("h3", { class: "category-name" }, c.name));
        if (editable) {
          block.append(
            h("span", {},
                h("button", {
                  class: "link",
                  onclick: () => {
                    const name = prompt("Rename category", c.name);
                    if (name) void act(() => api(`/api/categories/${c.id}`, { method: "PATCH", body: { name } }));
                  },
                }, "Rename"),
                h("button", {
                  class: "link danger",
                  onclick: () => {
                    if (confirm(`Delete the ${c.name} category and its dishes?`)) void act(() => api(`/api/categories/${c.id}`, { method: "DELETE" }));
                  },
                }, "Delete category")),
          );
        }
      }
      block.append(entries.length ? h("ul", { class: "entries" }, ...entries.map((e) => entryRow(e, editable))) : h("p", { class: "muted" }, "No dishes yet."));
      if (editable) block.append(addEntryForm(c.id));
      section.append(block);
    }
    if (editable) {
      section.append(
        h("button", {
          class: "link",
          onclick: () => {
            const name = prompt(multi ? "Name the new category" : "Name the new category (your current dishes become the first one)", "Dessert");
            if (name) void act(() => api(`/api/events/${eventId}/categories`, { method: "POST", body: { name } }));
          },
        }, multi ? "Add another category" : "Split into categories (e.g. Chili and Dessert)"),
      );
    }
    return section;
  }

  function organizersSection(): HTMLElement {
    const isCreator = data.role === "creator";
    const email = h("input", { type: "email", name: "email", required: true }) as HTMLInputElement;
    return h(
      "section",
      { class: "card" },
      h("h2", {}, "Organizers"),
      h("ul", {}, ...data.organizers.map((o) =>
        h("li", {}, o.email, o.role === "creator" ? h("span", { class: "muted" }, " (created it)") : null,
          isCreator && o.role === "co"
            ? h("button", { class: "link danger", onclick: () => act(() => api(`/api/events/${eventId}/organizers/${encodeURIComponent(o.email)}`, { method: "DELETE" })) }, "Remove")
            : null),
      )),
      isCreator
        ? h("form", {
            onsubmit: (e: Event) => {
              e.preventDefault();
              void act(() => api(`/api/events/${eventId}/organizers`, { method: "POST", body: { email: email.value } }));
            },
          }, h("label", {}, "Invite a co-organizer by email ", email), h("button", { type: "submit" }, "Invite"))
        : null,
    );
  }

  function detailsSection(): HTMLElement {
    const name = h("input", { name: "name", value: data.event.name, required: true }) as HTMLInputElement;
    const date = h("input", { name: "date", type: "date", value: data.event.date ?? "" }) as HTMLInputElement;
    return h(
      "section",
      { class: "card" },
      h("h2", {}, "Share and print"),
      h("p", {}, "Voting page: ", h("a", { href: `/v/${eventId}`, "data-link": true }, `${location.origin}/v/${eventId}`)),
      h("p", {}, "Typed code: ", h("strong", { class: "code" }, data.event.code)),
      h("p", {},
        h("a", { class: "button secondary", href: `/e/${eventId}/print/poster`, "data-link": true }, "Print the poster"), " ",
        h("a", { class: "button secondary", href: `/e/${eventId}/print/cards`, "data-link": true }, "Print the table cards")),
      h("details", {},
        h("summary", {}, "Edit name or date"),
        h("form", {
          onsubmit: (e: Event) => {
            e.preventDefault();
            void act(() => api(`/api/events/${eventId}`, { method: "PATCH", body: { name: name.value, date: date.value } }));
          },
        }, h("label", {}, "Name ", name), h("label", {}, "Date ", date), h("button", { type: "submit" }, "Save"))),
      data.role === "creator"
        ? h("button", {
            class: "link danger",
            onclick: () => {
              if (confirm(`Delete ${data.event.name} for good, with all its photos and votes?`)) {
                void api(`/api/events/${eventId}`, { method: "DELETE" }).then(() => ctx.navigate("/"));
              }
            },
          }, "Delete this event")
        : null,
    );
  }

  function draw(): void {
    clearTimeout(peekTimer);
    mount(
      ctx.root,
      h("p", {}, h("a", { href: "/", "data-link": true }, "← Your cookoffs")),
      h("h1", {}, data.event.name),
      notice,
      statusControls(),
      data.event.status === "open" ? votesCast() : null,
      categoriesSection(),
      detailsSection(),
      organizersSection(),
    );
    clearInterval(pollTimer);
    // Keep the votes-cast count live while voting runs.
    if (data.event.status === "open") pollTimer = setInterval(() => void poll().catch(() => {}), POLL_MS);
  }

  draw();
  return () => {
    clearInterval(pollTimer);
    clearTimeout(peekTimer);
  };
}
