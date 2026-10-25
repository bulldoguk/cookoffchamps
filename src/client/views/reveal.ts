import { revealSequence, type RevealStep } from "../../shared/ranking";
import { api } from "../api";
import type { Ctx } from "../app";
import { h, mount, ordinal, photoUrl } from "../dom";
import type { ManageView, Totals } from "../types";

interface Slide {
  category: string | null; // null for a single contest (decision 12)
  step: RevealStep;
}

/** Every click of the reveal, category by category, 3rd → 1st within each (decisions 7, 8, 12). */
export function buildSlides(data: ManageView, totals: Totals["totals"]): Slide[] {
  const multi = data.categories.length > 1;
  return data.categories.flatMap((c) =>
    revealSequence(totals.filter((t) => t.categoryId === c.id)).map((step) => ({ category: multi ? c.name : null, step })),
  );
}

export function placeLabel(step: RevealStep): string {
  if (step.coChampions) return "Co-champions!";
  if (step.place === 1) return "Champion!";
  return `${ordinal(step.place)} place${step.entryIds.length > 1 ? " (tied)" : ""}`;
}

/** /e/:id/reveal, for a phone or a TV. Click, tap, space or → for the next place. */
export async function revealView(ctx: Ctx, eventId: string): Promise<() => void> {
  const data = await api<ManageView>(`/api/events/${eventId}`);
  const back = h("p", {}, h("a", { href: `/e/${eventId}`, "data-link": true }, "← Back to the event"));

  if (data.event.status !== "closed" && data.event.status !== "revealed") {
    mount(ctx.root, back, h("h1", {}, "Not yet"), h("p", {}, "Close voting first, then come back to reveal the winners."));
    return () => {};
  }

  const { totals } = await api<Totals>(`/api/events/${eventId}/totals`);
  const slides = buildSlides(data, totals);
  let shown = -1; // -1 is the title card
  const stage = h("div", { class: "reveal", tabindex: "0" });

  function draw(): void {
    if (shown < 0) {
      stage.replaceChildren(h("h1", {}, data.event.name), h("p", { class: "hint" }, slides.length ? "Tap for 3rd place" : "There are no dishes to reveal."));
      return;
    }
    const { category, step } = slides[shown]!;
    mount(
      stage,
      category ? h("p", { class: "category" }, category) : null,
      h("p", { class: "place" }, placeLabel(step)),
      h("div", { class: "winners" }, ...step.entryIds.map((id) => {
        const e = data.entries.find((x) => x.id === id)!;
        return h(
          "div",
          { class: "winner" },
          e.photoKey ? h("img", { src: photoUrl(e.photoKey), alt: e.dishName }) : null,
          h("p", { class: "dish-name" }, e.dishName),
          // The cook's name is seen here for the first time (decision 9).
          h("p", { class: "cook" }, e.cookName),
          h("p", { class: "votes" }, `${step.votes} vote${step.votes === 1 ? "" : "s"}`),
        );
      })),
      shown < slides.length - 1 ? h("p", { class: "hint" }, "Tap for the next place") : h("p", { class: "hint" }, "🎉"),
    );
  }

  async function next(): Promise<void> {
    if (shown >= slides.length - 1) return;
    shown += 1;
    draw();
    // Once the last winner is on screen, the results go public (decision 13).
    if (shown === slides.length - 1 && data.event.status === "closed") {
      await api(`/api/events/${eventId}/status`, { method: "POST", body: { status: "revealed" } });
      data.event.status = "revealed";
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      void next();
    }
  };
  stage.addEventListener("click", () => void next());
  document.addEventListener("keydown", onKey);
  mount(ctx.root, back, stage);
  draw();
  stage.focus();
  return () => document.removeEventListener("keydown", onKey);
}
