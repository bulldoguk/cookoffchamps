import { api } from "../api";
import type { Ctx } from "../app";
import { h, logo, mount } from "../dom";
import { renderQr } from "../qr";
import type { ManageView } from "../types";

/**
 * /e/:id/print/poster and /e/:id/print/cards, each printable on its own
 * (decision 11). The page is print-styled for US Letter; the toolbar hides on paper.
 */
export async function printView(ctx: Ctx, eventId: string, kind: string): Promise<void> {
  const data = await api<ManageView>(`/api/events/${eventId}`);
  const origin = ctx.url.origin;
  const voteUrl = `${origin}/v/${eventId}`;
  const toolbar = h(
    "div",
    { class: "toolbar no-print" },
    h("a", { href: `/e/${eventId}`, "data-link": true }, "← Back"),
    " ",
    h("button", { onclick: () => window.print() }, "Print"),
    h("span", { class: "muted" }, "Sized for US Letter paper"),
  );

  if (kind === "poster") {
    const qr = h("div", { class: "qr" });
    mount(
      ctx.root,
      toolbar,
      h(
        "div",
        { class: "page poster" },
        logo("poster-logo"),
        h("h1", {}, data.event.name),
        h("p", { class: "lead" }, "Vote for your favourite dish!"),
        qr,
        h("p", {}, "Scan with your phone's camera, or go to"),
        h("p", { class: "url" }, `${ctx.url.host}/c/${data.event.code}`),
        h("p", {}, "and enter the code ", h("strong", { class: "code" }, data.event.code)),
      ),
    );
    await renderQr(qr, voteUrl);
    return;
  }

  // Tent cards: one per dish, "Entry N" to match the voting page (decision 9),
  // and a QR code that opens voting with this dish highlighted.
  const multi = data.categories.length > 1;
  const cards = data.entries.map((e) => {
    const qr = h("div", { class: "qr small" });
    const category = data.categories.find((c) => c.id === e.categoryId)!;
    const card = h(
      "div",
      { class: "tent-card" },
      multi ? h("p", { class: "category" }, category.name) : null,
      h("p", { class: "number" }, `Entry ${e.number}`),
      h("p", { class: "dish-name" }, e.dishName),
      qr,
      h("p", { class: "muted" }, "Scan to vote"),
    );
    return { card, qr, url: `${voteUrl}?entry=${e.id}` };
  });
  mount(
    ctx.root,
    toolbar,
    cards.length ? h("div", { class: "page cards" }, ...cards.map((c) => c.card)) : h("p", {}, "Add some dishes first."),
  );
  await Promise.all(cards.map((c) => renderQr(c.qr, c.url)));
}
