import { describe, expect, it } from "vitest";
import { rankTallies, revealSequence } from "../../src/shared/ranking";

const t = (entryId: string, votes: number) => ({ entryId, votes });

describe("rankTallies", () => {
  it("orders by votes, most first", () => {
    expect(rankTallies([t("a", 1), t("b", 5), t("c", 3)])).toEqual([
      { place: 1, entryIds: ["b"], votes: 5 },
      { place: 2, entryIds: ["c"], votes: 3 },
      { place: 3, entryIds: ["a"], votes: 1 },
    ]);
  });

  it("shares a place on a tie and skips the next place", () => {
    expect(rankTallies([t("a", 4), t("b", 4), t("c", 2)])).toEqual([
      { place: 1, entryIds: ["a", "b"], votes: 4 },
      { place: 3, entryIds: ["c"], votes: 2 },
    ]);
  });

  it("places entries with no votes", () => {
    expect(rankTallies([t("a", 0), t("b", 0)])).toEqual([
      { place: 1, entryIds: ["a", "b"], votes: 0 },
    ]);
  });

  it("returns nothing for no entries, and leaves the input untouched", () => {
    const input = [t("a", 1), t("b", 2)];
    expect(rankTallies([])).toEqual([]);
    rankTallies(input);
    expect(input).toEqual([t("a", 1), t("b", 2)]);
  });
});

describe("revealSequence", () => {
  it("reveals 3rd, then 2nd, then 1st", () => {
    const steps = revealSequence([t("a", 9), t("b", 5), t("c", 3), t("d", 1)]);
    expect(steps.map((s) => s.place)).toEqual([3, 2, 1]);
    expect(steps.map((s) => s.entryIds)).toEqual([["c"], ["b"], ["a"]]);
    expect(steps.every((s) => !s.coChampions)).toBe(true);
  });

  it("reveals a shared 2nd in one click", () => {
    const steps = revealSequence([t("a", 9), t("b", 5), t("c", 5), t("d", 1)]);
    expect(steps).toEqual([
      { place: 2, entryIds: ["b", "c"], votes: 5, coChampions: false },
      { place: 1, entryIds: ["a"], votes: 9, coChampions: false },
    ]);
  });

  it("marks a tie for 1st as co-champions", () => {
    const steps = revealSequence([t("a", 6), t("b", 6), t("c", 2)]);
    expect(steps).toEqual([
      { place: 3, entryIds: ["c"], votes: 2, coChampions: false },
      { place: 1, entryIds: ["a", "b"], votes: 6, coChampions: true },
    ]);
  });

  it("reveals only as many places as there are entries", () => {
    expect(revealSequence([t("a", 2)])).toEqual([
      { place: 1, entryIds: ["a"], votes: 2, coChampions: false },
    ]);
    expect(revealSequence([])).toEqual([]);
  });
});
