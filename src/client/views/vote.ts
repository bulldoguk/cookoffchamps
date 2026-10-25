import { api, ApiError } from "../api";
import type { Ctx } from "../app";
import { dateEl, h, mount, ordinal, photoUrl } from "../dom";
import { getTurnstileToken } from "../turnstile";
import type { PublicEntry, PublicView } from "../types";

function dishCard(entry: PublicEntry, extra: Node[]): HTMLElement {
  return h(
    "div",
    { class: "dish", "data-entry": entry.id },
    entry.photoKey ? h("img", { src: photoUrl(entry.photoKey), alt: entry.dishName, loading: "lazy" }) : h("div", { class: "no-photo" }, "🍲"),
    h("p", { class: "number" }, `Entry ${entry.number}`),
    h("p", { class: "dish-name" }, entry.dishName),
    ...extra,
  );
}

/** Results, once revealed (decision 13): placings with cooks, counts and photos. */
function results(view: PublicView): Node[] {
  const multi = view.categories.length > 1;
  return view.categories.map((c) =>
    h(
      "section",
      { class: "results" },
      multi ? h("h2", {}, c.name) : null,
      h("ol", { class: "placings" }, ...c.placings!.map((p) =>
        h(
          "li",
          { "data-place": p.place },
          h("p", { class: "place" }, p.place === 1 && p.entryIds.length > 1 ? "Co-champions!" : `${ordinal(p.place)} place${p.entryIds.length > 1 ? " (tied)" : ""}`),
          ...p.entryIds.map((id) => {
            const e = c.entries.find((x) => x.id === id)!;
            return dishCard(e, [h("p", { class: "cook" }, `by ${e.cookName}`), h("p", { class: "votes" }, `${e.votes} vote${e.votes === 1 ? "" : "s"}`)]);
          }),
        ),
      )),
    ),
  );
}

/** /v/:id. What the QR code opens: voting, then "closed", then the results. */
export async function voteView(ctx: Ctx, eventId: string): Promise<void> {
  const view = await api<PublicView>(`/api/public/events/${eventId}`);
  const { event } = view;
  const highlight = ctx.url.searchParams.get("entry");
  // Fixed near the bottom of the screen, so the guest sees it wherever they scrolled.
  const notice = h("p", { class: "status toast", role: "status" });
  const turnstileBox = h("div", { class: "turnstile" });
  const header = [h("h1", {}, event.name), event.date ? h("p", { class: "muted event-date" }, dateEl(event.date)) : null];

  if (event.status === "revealed") {
    mount(ctx.root, ...header, ...results(view));
    return;
  }

  const open = event.status === "open";
  const intro =
    event.status === "setup"
      ? "Voting hasn't opened yet. Have a look at the dishes, and come back when the organizer opens it."
      : open
        ? "Tap your favourite dish. You can change your mind until voting closes."
        : "Voting is closed. The results are coming soon!";

  async function castVote(categoryId: string, entryId: string, card: HTMLElement): Promise<void> {
    // Instant feedback on the card that was tapped, before the round trip.
    card.classList.add("pending");
    card.setAttribute("aria-busy", "true");
    notice.textContent = "Voting…";
    try {
      const token = await getTurnstileToken(view.turnstileSiteKey, turnstileBox);
      await api(`/api/public/events/${eventId}/votes`, { method: "POST", body: { categoryId, entryId, turnstileToken: token } });
      view.myVotes[categoryId] = entryId;
      notice.textContent = "Vote saved. Thanks!";
      draw();
    } catch (err) {
      card.classList.remove("pending");
      card.removeAttribute("aria-busy");
      if (err instanceof ApiError && err.status === 409) {
        notice.textContent = "Voting has closed.";
      } else {
        notice.textContent = (err as Error).message;
      }
    }
  }

  function draw(): void {
    const multi = view.categories.length > 1;
    mount(
      ctx.root,
      ...header,
      h("p", { class: open ? "live" : "muted" }, intro),
      notice,
      ...view.categories.map((c) =>
        h(
          "section",
          {},
          multi ? h("h2", {}, c.name) : null,
          c.entries.length ? null : h("p", { class: "muted" }, "No dishes yet."),
          h("div", { class: "dishes" }, ...c.entries.map((e) => {
            const mine = view.myVotes[c.id] === e.id;
            const card = dishCard(e, mine ? [h("p", { class: "your-vote" }, "✓ Your vote")] : []);
            if (mine) card.classList.add("chosen");
            if (e.id === highlight) card.classList.add("highlight");
            if (open) {
              card.setAttribute("role", "button");
              card.setAttribute("tabindex", "0");
              card.setAttribute("aria-pressed", String(mine));
              card.setAttribute("aria-label", `Entry ${e.number}, ${e.dishName}`);
              card.addEventListener("click", () => void castVote(c.id, e.id, card));
              // A div with role=button needs the keys a real button gets for free.
              card.addEventListener("keydown", (ev) => {
                if (ev.key !== "Enter" && ev.key !== " ") return;
                ev.preventDefault();
                void castVote(c.id, e.id, card);
              });
            }
            return card;
          })),
        ),
      ),
      turnstileBox,
    );
    // Arriving from a tent card's QR code scrolls to that dish.
    ctx.root.querySelector(".highlight")?.scrollIntoView?.({ block: "center" });
  }

  draw();
}
