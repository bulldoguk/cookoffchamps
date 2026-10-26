import { revealSequence, type RevealStep } from "../../shared/ranking";
import { api } from "../api";
import type { Ctx } from "../app";
import { dateEl, h, logo, mount, photoUrl } from "../dom";
import { m } from "../i18n";
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
  if (step.coChampions) return m().common.coChampions;
  if (step.place === 1) return m().reveal.champion;
  return m().common.place(step.place, step.entryIds.length > 1);
}

const CONFETTI_COLOURS = ["var(--gold)", "var(--accent)", "var(--good)", "var(--silver)", "var(--bronze)", "var(--confetti-extra)"];

/**
 * A one-off shower of confetti for the champion. The pieces are spread by a
 * fixed formula rather than at random, so every reveal (and every test) looks
 * the same. CSS drops them once and hides them under prefers-reduced-motion.
 */
export function confetti(count = 72): HTMLElement {
  const box = h("div", { class: "confetti", "aria-hidden": "true" });
  for (let i = 0; i < count; i++) {
    const style = [
      `--x:${(i * 37) % 100}%`,
      `--d:${((i * 53) % 140) / 100}s`,
      `--t:${3 + ((i * 29) % 25) / 10}s`,
      `--w:${8 + ((i * 7) % 8)}px`,
      `--r:${360 + ((i * 97) % 540)}deg`,
      `--sway:${((i * 61) % 160) - 80}px`,
      `--c:${CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]}`,
    ].join(";");
    box.append(h("span", { style }));
  }
  return box;
}

/** /e/:id/reveal, for a phone or a TV. Click, tap, space or → for the next place. */
export async function revealView(ctx: Ctx, eventId: string): Promise<() => void> {
  const data = await api<ManageView>(`/api/events/${eventId}`);
  const t = m();
  const back = h("p", { class: "reveal-back" }, h("a", { href: `/e/${eventId}`, "data-link": true }, t.reveal.back));

  if (data.event.status !== "closed" && data.event.status !== "revealed") {
    mount(ctx.root, back, h("h1", {}, t.reveal.notYet), h("p", {}, t.reveal.closeFirst));
    return () => {};
  }

  const { totals } = await api<Totals>(`/api/events/${eventId}/totals`);
  const slides = buildSlides(data, totals);
  let shown = -1; // -1 is the title card
  // aria-live, so a screen reader announces each place as it lands.
  const stage = h("div", { class: "reveal", tabindex: "0", "aria-live": "polite" });

  function draw(): void {
    if (shown < 0) {
      mount(
        stage,
        logo(),
        h("h1", {}, data.event.name),
        data.event.date ? dateEl(data.event.date, "event-date") : null,
        h("p", { class: "hint" }, slides.length ? t.reveal.tapFirst : t.reveal.nothing),
      );
      return;
    }
    const { category, step } = slides[shown]!;
    stage.dataset.place = String(step.place);
    const champion = step.place === 1;
    mount(
      stage,
      champion ? h("div", { class: "sunburst", "aria-hidden": "true" }) : null,
      champion ? confetti() : null,
      category ? h("p", { class: "category" }, category) : null,
      // The medal repeats the place for the eye; the label below says it for everyone.
      h("div", { class: "medal", "aria-hidden": "true" }, String(step.place)),
      h("p", { class: "place" }, placeLabel(step)),
      h("div", { class: "winners" }, ...step.entryIds.map((id) => {
        const e = data.entries.find((x) => x.id === id)!;
        return h(
          "div",
          { class: "winner" },
          e.photoKey ? h("img", { src: photoUrl(e.photoKey), alt: e.dishName }) : null,
          h("p", { class: "dish-name" }, e.dishName),
          // The cook's name is seen here for the first time (decision 9).
          h("p", { class: "cook-label" }, t.reveal.cookedBy),
          h("p", { class: "cook" }, e.cookName),
          h("p", { class: "votes" }, t.common.votes(step.votes)),
        );
      })),
      h("p", { class: "hint" }, shown < slides.length - 1 ? t.reveal.tapNext : t.reveal.congrats),
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
  // Not focused on load: the keys work from anywhere on the page, and a focus
  // ring around the whole stage would look like a fault on a TV.
  draw();
  return () => document.removeEventListener("keydown", onKey);
}
