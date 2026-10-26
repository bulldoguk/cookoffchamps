import { api } from "../api";
import type { Ctx } from "../app";
import { confirmDialog, type ConfirmOptions } from "../dialog";
import { h, mount, photoUrl } from "../dom";
import { errorText, lang, m } from "../i18n";
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

const STEPS = ["setup", "open", "closed", "revealed"];

/** Where the event is in its life: set up → voting → closed → results. */
export function stepper(status: string): HTMLElement {
  const at = STEPS.indexOf(status);
  const labels = m().manage.steps;
  return h(
    "ol",
    { class: "stepper" },
    ...STEPS.map((step, i) =>
      h("li", { class: i < at ? "done" : undefined, "aria-current": i === at ? "step" : undefined }, labels[step]),
    ),
  );
}

/** The organizer's screen: set up, run voting, peek, and get to print and reveal. */
export async function manageView(ctx: Ctx, eventId: string): Promise<() => void> {
  let data = await api<ManageView>(`/api/events/${eventId}`);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  const notice = h("p", { class: "status", role: "status" });
  // Read once per view: a language switch redraws the whole view.
  const t = m().manage;
  const common = m().common;

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
      notice.textContent = errorText(err);
    }
  }

  function setStatus(status: string) {
    return act(() => api(`/api/events/${eventId}/status`, { method: "POST", body: { status } }));
  }

  /** setStatus, but only after the organizer confirms (SW-23). */
  async function setStatusIfSure(status: string, ask: ConfirmOptions): Promise<void> {
    if (await confirmDialog(ask)) await setStatus(status);
  }

  async function startReveal(): Promise<void> {
    const sure = await confirmDialog({ title: t.revealTitle, body: t.revealBody, confirm: t.revealConfirm });
    if (sure) ctx.navigate(`/e/${eventId}/reveal`);
  }

  // Closing and revealing can both be undone for a family event (decision 17),
  // so neither is a trap; the dialogs stop them happening by accident.
  function statusControls(): HTMLElement {
    const s = data.event.status;
    const box = h("section", { class: "card controls", "aria-label": t.progress }, stepper(s));
    if (s === "setup") {
      box.append(h("p", {}, t.setupHint), h("button", { onclick: () => setStatus("open") }, t.openVoting));
    } else if (s === "open") {
      const close = () => setStatusIfSure("closed", { title: t.closeTitle, body: t.closeBody, confirm: t.closeVoting });
      box.append(h("p", { class: "live" }, t.isOpen), h("button", { onclick: close }, t.closeVoting));
    } else if (s === "closed") {
      box.append(
        h("p", {}, t.closedHint),
        h("button", { onclick: () => void startReveal() }, t.startReveal),
        h("button", { class: "secondary", onclick: () => setStatus("open") }, t.reopen),
        h("p", { class: "aside" }, t.reopenAside),
      );
    } else {
      const undo = () => setStatusIfSure("closed", { title: t.undoTitle, body: t.undoBody, confirm: t.undo });
      box.append(
        h("p", {}, t.resultsOut),
        h("a", { class: "button", href: `/v/${eventId}`, "data-link": true }, t.seeResults),
        h("button", { class: "secondary", onclick: undo }, t.undo),
      );
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
    return h("section", { class: "card" }, h("h2", {}, t.votesCast), countEl, perCategory, peekSection());
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
    const button = h("button", { class: "secondary" }, t.peek) as HTMLButtonElement;
    button.addEventListener("click", async () => {
      if (!panel.hidden) {
        panel.hidden = true;
        button.textContent = t.peek;
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
            h("ol", {}, ...rows.map((row) => {
              const entry = data.entries.find((e) => e.id === row.entryId)!;
              return h("li", {}, t.peekRow(entry.number, entry.dishName, entry.cookName, row.votes));
            })),
          );
        }),
      );
      panel.hidden = false;
      button.textContent = t.hidePeek;
      clearTimeout(peekTimer);
      peekTimer = setTimeout(() => {
        panel.hidden = true;
        button.textContent = t.peek;
      }, PEEK_MS);
    });
    return h("div", {}, button, panel);
  }

  function entryRow(entry: ManageEntry, editable: boolean): HTMLElement {
    const li = h(
      "li",
      { class: "entry" },
      entry.photoKey ? h("img", { src: photoUrl(entry.photoKey), alt: "", class: "thumb" }) : h("span", { class: "thumb none" }, t.noPhoto),
      h("span", {}, h("strong", {}, common.entry(entry.number)), ` ${entry.dishName} `, h("span", { class: "muted" }, common.by(entry.cookName))),
    );
    if (editable) {
      li.append(
        h("button", { class: "link", onclick: () => li.replaceWith(editEntryForm(entry)) }, t.edit),
        h("button", {
          class: "link danger",
          onclick: () => {
            if (confirm(t.deleteEntry(entry.number, entry.dishName))) void act(() => api(`/api/entries/${entry.id}`, { method: "DELETE" }));
          },
        }, t.delete),
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
      h("label", {}, common.cookLabel, cook),
      h("label", {}, common.dishLabel, dish),
      h("label", {}, t.newPhoto, photo),
      h("button", { type: "submit" }, common.save),
      h("button", { type: "button", class: "link", onclick: () => draw() }, common.cancel),
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
          notice.textContent = t.adding;
          void act(async () =>
            api(`/api/categories/${categoryId}/entries`, {
              method: "POST",
              body: await entryForm({ cookName: cook.value, dishName: dish.value, photo: photo.files?.[0] ?? null }),
            }),
          );
        },
      },
      h("h3", {}, t.addDish),
      h("label", {}, common.cookLabel, cook),
      h("label", {}, common.dishLabel, dish),
      h("label", {}, t.photo, photo),
      h("button", { type: "submit" }, t.add),
    );
  }

  function categoriesSection(): HTMLElement {
    const editable = data.event.status === "setup" || data.event.status === "open";
    // A single contest shows no category headings at all (decision 12).
    const multi = data.categories.length > 1;
    const section = h("section", { class: "card" }, h("h2", {}, t.dishes));
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
                    const name = prompt(t.renameCategory, c.name);
                    if (name) void act(() => api(`/api/categories/${c.id}`, { method: "PATCH", body: { name } }));
                  },
                }, t.rename),
                h("button", {
                  class: "link danger",
                  onclick: () => {
                    if (confirm(t.deleteCategoryConfirm(c.name))) void act(() => api(`/api/categories/${c.id}`, { method: "DELETE" }));
                  },
                }, t.deleteCategory)),
          );
        }
      }
      block.append(entries.length ? h("ul", { class: "entries" }, ...entries.map((e) => entryRow(e, editable))) : h("p", { class: "muted" }, common.noDishes));
      if (editable) block.append(addEntryForm(c.id));
      section.append(block);
    }
    if (editable) {
      section.append(
        h("button", {
          class: "link",
          onclick: () => {
            const name = prompt(multi ? t.nameCategory : t.nameFirstCategory, t.categoryExample);
            if (name) void act(() => api(`/api/events/${eventId}/categories`, { method: "POST", body: { name } }));
          },
        }, multi ? t.addCategory : t.splitCategories),
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
      h("h2", {}, t.organizers),
      h("ul", {}, ...data.organizers.map((o) =>
        h("li", {}, o.email, o.role === "creator" ? h("span", { class: "muted" }, t.createdIt) : null,
          isCreator && o.role === "co"
            ? h("button", { class: "link danger", onclick: () => act(() => api(`/api/events/${eventId}/organizers/${encodeURIComponent(o.email)}`, { method: "DELETE" })) }, t.remove)
            : null),
      )),
      isCreator
        ? h("form", {
            onsubmit: (e: Event) => {
              e.preventDefault();
              // The invite email is written in the inviter's language (SW-27).
              void act(() => api(`/api/events/${eventId}/organizers`, { method: "POST", body: { email: email.value, lang: lang() } }));
            },
          }, h("label", {}, t.inviteLabel, email), h("button", { type: "submit" }, t.invite))
        : null,
    );
  }

  function detailsSection(): HTMLElement {
    const name = h("input", { name: "name", value: data.event.name, required: true }) as HTMLInputElement;
    const date = h("input", { name: "date", type: "date", value: data.event.date ?? "" }) as HTMLInputElement;
    return h(
      "section",
      { class: "card" },
      h("h2", {}, t.shareAndPrint),
      h("p", {}, t.votingPage, h("a", { href: `/v/${eventId}`, "data-link": true }, `${location.origin}/v/${eventId}`)),
      h("p", {}, t.typedCode, h("strong", { class: "code" }, data.event.code)),
      h("p", {},
        h("a", { class: "button secondary", href: `/e/${eventId}/print/poster`, "data-link": true }, t.printPoster), " ",
        h("a", { class: "button secondary", href: `/e/${eventId}/print/cards`, "data-link": true }, t.printCards)),
      h("details", {},
        h("summary", {}, t.editDetails),
        h("form", {
          onsubmit: (e: Event) => {
            e.preventDefault();
            void act(() => api(`/api/events/${eventId}`, { method: "PATCH", body: { name: name.value, date: date.value } }));
          },
        }, h("label", {}, common.nameLabel, name), h("label", {}, common.dateLabel, date), h("button", { type: "submit" }, common.save))),
      data.role === "creator"
        ? h("button", {
            class: "link danger",
            onclick: () => {
              if (confirm(t.deleteEventConfirm(data.event.name))) {
                void api(`/api/events/${eventId}`, { method: "DELETE" }).then(() => ctx.navigate("/"));
              }
            },
          }, t.deleteEvent)
        : null,
    );
  }

  function draw(): void {
    clearTimeout(peekTimer);
    mount(
      ctx.root,
      h("p", {}, h("a", { href: "/", "data-link": true }, t.back)),
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
