import type { Placing } from "../shared/ranking";

export type Status = "setup" | "open" | "closed" | "revealed";

export interface EventSummary {
  id: string;
  code: string;
  name: string;
  date: string | null;
  status: Status;
}

export interface ManageEntry {
  id: string;
  categoryId: string;
  number: number;
  cookName: string;
  dishName: string;
  photoKey: string | null;
}

export interface ManageView {
  event: EventSummary;
  role: "creator" | "co";
  categories: { id: string; name: string; position: number }[];
  entries: ManageEntry[];
  organizers: { email: string; role: "creator" | "co" }[];
  votesCast: { categoryId: string; votes: number }[];
}

export interface Totals {
  totals: { entryId: string; categoryId: string; votes: number }[];
}

export interface PublicEntry {
  id: string;
  number: number;
  dishName: string;
  photoKey: string | null;
  cookName?: string;
  votes?: number;
}

export interface PublicView {
  event: EventSummary;
  turnstileSiteKey: string;
  myVotes: Record<string, string>;
  categories: { id: string; name: string; entries: PublicEntry[]; placings?: Placing[] }[];
}
