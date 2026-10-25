// Placings and the 3-2-1 reveal. Shared by the Worker (results) and the client
// (reveal screen), so the two can never disagree about who came where.

export interface Tally {
  entryId: string;
  votes: number;
}

export interface Placing {
  place: number; // 1 = winner
  entryIds: string[]; // more than one means a tie (decision 8)
  votes: number;
}

/**
 * Standard competition ranking ("1224"): tied entries share a place, and the
 * next place skips by the size of the tie. Entries with no votes still place.
 * Ties are listed in the order given, so callers decide the tie order.
 */
export function rankTallies(tallies: readonly Tally[]): Placing[] {
  const sorted = [...tallies].sort((a, b) => b.votes - a.votes);
  const placings: Placing[] = [];
  let seen = 0;
  for (const t of sorted) {
    const last = placings[placings.length - 1];
    if (last && last.votes === t.votes) {
      last.entryIds.push(t.entryId);
    } else {
      placings.push({ place: seen + 1, entryIds: [t.entryId], votes: t.votes });
    }
    seen += 1;
  }
  return placings;
}

export interface RevealStep {
  place: number;
  entryIds: string[];
  votes: number;
  coChampions: boolean; // a tie for 1st (decision 8)
}

/**
 * The clicks of the reveal (decision 7): the podium places, worst first, so the
 * last click is the winner. A shared place is one click. Places past 3rd are
 * not revealed, and a category with no entries reveals nothing.
 */
export function revealSequence(tallies: readonly Tally[]): RevealStep[] {
  return rankTallies(tallies)
    .filter((p) => p.place <= 3)
    .reverse()
    .map((p) => ({
      place: p.place,
      entryIds: p.entryIds,
      votes: p.votes,
      coChampions: p.place === 1 && p.entryIds.length > 1,
    }));
}
