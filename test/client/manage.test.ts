import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManageView } from "../../src/client/types";
import { entryForm, manageView, PEEK_MS, POLL_MS, stepper } from "../../src/client/views/manage";
import { byText, fakeApi, fill, flush, makeCtx, submit } from "./helpers";

vi.mock("../../src/client/photo", () => ({ resizePhoto: vi.fn(async () => new Blob(["small"], { type: "image/jpeg" })) }));

function view(overrides: Partial<ManageView> = {}, status: ManageView["event"]["status"] = "setup"): ManageView {
  return {
    event: { id: "e1", code: "K7QM2X", name: "Chili Night", date: "2026-11-01", status },
    role: "creator",
    categories: [{ id: "c1", name: "Main", position: 1 }],
    entries: [
      { id: "n1", categoryId: "c1", number: 1, cookName: "Grandma", dishName: "Red chili", photoKey: "events/e1/n1-x" },
      { id: "n2", categoryId: "c1", number: 2, cookName: "Kiana", dishName: "White chili", photoKey: null },
    ],
    organizers: [
      { email: "gary@example.com", role: "creator" },
      { email: "kiana@example.com", role: "co" },
    ],
    votesCast: [{ categoryId: "c1", votes: 7 }],
    ...overrides,
  };
}

let calls: ReturnType<typeof fakeApi>;

function serve(data: ManageView, extra: Record<string, unknown> = {}) {
  calls = fakeApi({ "GET /api/events/e1": () => data, ...extra });
}

async function open(data: ManageView, extra: Record<string, unknown> = {}) {
  serve(data, extra);
  const ctx = makeCtx("/e/e1");
  const cleanup = await manageView(ctx, "e1");
  return { ctx, cleanup };
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "prompt").mockReturnValue("Dessert");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("entryForm", () => {
  it("includes only the fields given, with the photo shrunk", async () => {
    const empty = await entryForm({});
    expect([...empty.keys()]).toEqual([]);
    const full = await entryForm({ cookName: "A", dishName: "B", photo: new File(["big"], "x.heic") });
    expect(full.get("cookName")).toBe("A");
    expect(full.get("dishName")).toBe("B");
    expect((full.get("photo") as File).name).toBe("dish.jpg");
    expect(await (full.get("photo") as File).text()).toBe("small");
    expect((await entryForm({ photo: null })).has("photo")).toBe(false);
  });
});

describe("progress stepper", () => {
  const state = (status: string) =>
    [...stepper(status).children].map((li) => `${li.textContent}:${li.className || "-"}:${li.getAttribute("aria-current") ?? "-"}`);

  it("marks earlier steps done and the current one as the step", () => {
    expect(state("setup")).toEqual(["Set up:-:step", "Voting:-:-", "Closed:-:-", "Results:-:-"]);
    expect(state("closed")).toEqual(["Set up:done:-", "Voting:done:-", "Closed:-:step", "Results:-:-"]);
    expect(state("revealed")).toEqual(["Set up:done:-", "Voting:done:-", "Closed:done:-", "Results:-:step"]);
  });
});

describe("status controls", () => {
  it("opens voting from setup", async () => {
    const { ctx } = await open(view(), { "POST /api/events/e1/status": { status: "open" } });
    expect(ctx.root.querySelector('.stepper [aria-current="step"]')!.textContent).toBe("Set up");
    expect(ctx.root.textContent).toContain("Add the dishes, print the poster, then open voting.");
    byText(ctx.root, "button", "Open voting").click();
    await flush();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ status: "open" });
  });

  it("closes voting while open, and shows the live votes-cast count", async () => {
    const { ctx, cleanup } = await open(view({}, "open"), { "POST /api/events/e1/status": { status: "closed" } });
    expect(ctx.root.querySelector("[data-testid=votes-cast]")!.textContent).toBe("7");
    byText(ctx.root, "button", "Close voting").click();
    await flush();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ status: "closed" });
    cleanup();
  });

  it("offers the reveal or a reopen once closed", async () => {
    const { ctx } = await open(view({}, "closed"), { "POST /api/events/e1/status": { status: "open" } });
    expect(byText(ctx.root, "a", "Start the reveal").getAttribute("href")).toBe("/e/e1/reveal");
    byText(ctx.root, "button", "Reopen voting").click();
    await flush();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ status: "open" });
  });

  it("links to the results once revealed, and freezes the dishes", async () => {
    const { ctx } = await open(view({}, "revealed"));
    expect(byText(ctx.root, "a", "See the results page").getAttribute("href")).toBe("/v/e1");
    expect(ctx.root.querySelector(".entry-form")).toBeNull();
    expect(ctx.root.textContent).not.toContain("Delete entry");
  });

  it("shows a failed action in the notice line", async () => {
    const { ctx } = await open(view(), { "POST /api/events/e1/status": [409, { error: "Can't go from setup to open" }] });
    byText(ctx.root, "button", "Open voting").click();
    await flush();
    expect(ctx.root.querySelector(".status")!.textContent).toBe("Can't go from setup to open");
  });
});

describe("live polling while open", () => {
  it("refreshes the count, survives a failed refresh, and stops on cleanup", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const data = view({}, "open");
    const { ctx, cleanup } = await open(data);
    data.votesCast = [{ categoryId: "c1", votes: 9 }];
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(ctx.root.querySelector("[data-testid=votes-cast]")!.textContent).toBe("9");

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(ctx.root.querySelector("[data-testid=votes-cast]")!.textContent).toBe("9");

    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("redraws when the status changes under it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const data = view({}, "open");
    const { ctx, cleanup } = await open(data);
    data.event = { ...data.event, status: "closed" };
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(ctx.root.textContent).toContain("Voting is closed.");
    expect(vi.getTimerCount()).toBe(0);
    cleanup();
  });
});

describe("peek (decision 15)", () => {
  const totals = { totals: [{ entryId: "n1", categoryId: "c1", votes: 2 }, { entryId: "n2", categoryId: "c1", votes: 5 }] };

  it("is hidden until tapped, lists the standings, and hides again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const { ctx, cleanup } = await open(view({}, "open"), { "GET /api/events/e1/totals": totals });
    const panel = ctx.root.querySelector<HTMLElement>(".peek")!;
    expect(panel.hidden).toBe(true);
    const button = byText(ctx.root, "button", "Peek");
    button.click();
    await vi.waitFor(() => expect(panel.hidden).toBe(false));
    expect([...panel.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Entry 2, White chili (Kiana): 5",
      "Entry 1, Red chili (Grandma): 2",
    ]);
    expect(panel.querySelector("h3")).toBeNull();
    expect(ctx.root.querySelector<HTMLElement>(".per-category")!.hidden).toBe(true);
    expect(button.textContent).toBe("Hide the standings");

    // Tapping again hides it.
    button.click();
    expect(panel.hidden).toBe(true);
    expect(button.textContent).toBe("Peek at the standings");

    // Left open, it hides itself.
    button.click();
    await vi.waitFor(() => expect(panel.hidden).toBe(false));
    await vi.advanceTimersByTimeAsync(PEEK_MS);
    expect(panel.hidden).toBe(true);
    cleanup();
  });

  it("splits by category when there are several", async () => {
    const data = view({ categories: [{ id: "c1", name: "Chili", position: 1 }, { id: "c2", name: "Dessert", position: 2 }], votesCast: [{ categoryId: "c1", votes: 3 }] }, "open");
    const { ctx, cleanup } = await open(data, { "GET /api/events/e1/totals": totals });
    expect([...ctx.root.querySelectorAll(".per-category li")].map((li) => li.textContent)).toEqual(["Chili: 3", "Dessert: 0"]);
    byText(ctx.root, "button", "Peek").click();
    await vi.waitFor(() => expect(ctx.root.querySelectorAll(".peek h3")).toHaveLength(2));
    cleanup();
  });
});

describe("dishes", () => {
  it("lists entries with a photo or a placeholder", async () => {
    const { ctx } = await open(view());
    const rows = ctx.root.querySelectorAll(".entry");
    expect(rows[0]!.querySelector("img")!.getAttribute("src")).toBe("/api/photos/events/e1/n1-x");
    expect(rows[1]!.querySelector(".none")!.textContent).toBe("No photo");
    expect(rows[0]!.textContent).toContain("Entry 1 Red chili by Grandma");
    expect(ctx.root.querySelector(".category-name")).toBeNull();
  });

  it("says when a category has no dishes", async () => {
    const { ctx } = await open(view({ entries: [] }));
    expect(ctx.root.textContent).toContain("No dishes yet.");
  });

  it("adds a dish with its photo", async () => {
    const { ctx } = await open(view(), { "POST /api/categories/c1/entries": [201, { id: "n3", number: 3 }] });
    const form = ctx.root.querySelector<HTMLFormElement>(".entry-form")!;
    fill(form, "cookName", "Shannon");
    fill(form, "dishName", "Verde");
    const input = form.querySelector<HTMLInputElement>("[name=photo]")!;
    expect(input.getAttribute("capture")).toBe("environment");
    Object.defineProperty(input, "files", { value: [new File(["big"], "p.jpg")] });
    submit(form);
    await flush();
    const post = calls.find((c) => c.method === "POST")!;
    const body = post.body as FormData;
    expect([body.get("cookName"), body.get("dishName")]).toEqual(["Shannon", "Verde"]);
    expect(body.get("photo")).toBeInstanceOf(File);
  });

  it("adds a dish without a photo", async () => {
    const { ctx } = await open(view(), { "POST /api/categories/c1/entries": [201, {}] });
    submit(ctx.root.querySelector(".entry-form")!);
    await flush();
    expect((calls.find((c) => c.method === "POST")!.body as FormData).has("photo")).toBe(false);
  });

  it("edits a dish, or cancels the edit", async () => {
    const { ctx } = await open(view(), { "PATCH /api/entries/n1": { ok: true } });
    byText(ctx.root, "button", "Edit").click();
    const form = ctx.root.querySelector<HTMLFormElement>("form.entry-form")!;
    expect((form.querySelector("[name=cookName]") as HTMLInputElement).value).toBe("Grandma");
    byText(form, "button", "Cancel").click();
    expect(ctx.root.querySelectorAll(".entry")).toHaveLength(2);

    byText(ctx.root, "button", "Edit").click();
    const again = ctx.root.querySelector<HTMLFormElement>("form.entry-form")!;
    fill(again, "dishName", "Texas red");
    submit(again);
    await flush();
    const patch = calls.find((c) => c.method === "PATCH")!.body as FormData;
    expect([patch.get("cookName"), patch.get("dishName"), patch.has("photo")]).toEqual(["Grandma", "Texas red", false]);
  });

  it("edits a dish's photo", async () => {
    const { ctx } = await open(view(), { "PATCH /api/entries/n1": { ok: true } });
    byText(ctx.root, "button", "Edit").click();
    const form = ctx.root.querySelector<HTMLFormElement>("form.entry-form")!;
    Object.defineProperty(form.querySelector("[name=photo]"), "files", { value: [new File(["x"], "p.jpg")] });
    submit(form);
    await flush();
    expect((calls.find((c) => c.method === "PATCH")!.body as FormData).has("photo")).toBe(true);
  });

  it("deletes a dish only after confirming", async () => {
    const { ctx } = await open(view(), { "DELETE /api/entries/n1": { ok: true } });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    byText(ctx.root, "button", "Delete").click();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    byText(ctx.root, "button", "Delete").click();
    await flush();
    expect(calls.find((c) => c.method === "DELETE")!.path).toBe("/api/entries/n1");
  });
});

describe("categories (decision 12)", () => {
  it("offers to split a single contest, and creates the category", async () => {
    const { ctx } = await open(view(), { "POST /api/events/e1/categories": [201, { id: "c2" }] });
    byText(ctx.root, "button", "Split into categories").click();
    await flush();
    expect(window.prompt).toHaveBeenCalledWith(expect.stringContaining("your current dishes become the first one"), "Dessert");
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Dessert" });
  });

  it("does nothing when the prompt is cancelled", async () => {
    const { ctx } = await open(view());
    vi.mocked(window.prompt).mockReturnValue(null);
    byText(ctx.root, "button", "Split into categories").click();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("shows headings, rename and delete once there are several", async () => {
    const data = view({ categories: [{ id: "c1", name: "Chili", position: 1 }, { id: "c2", name: "Dessert", position: 2 }] });
    const { ctx } = await open(data, { "PATCH /api/categories/c1": { ok: true }, "DELETE /api/categories/c2": { ok: true }, "POST /api/events/e1/categories": [201, {}] });
    expect([...ctx.root.querySelectorAll(".category-name")].map((x) => x.textContent)).toEqual(["Chili", "Dessert"]);

    vi.mocked(window.prompt).mockReturnValueOnce("Chili con carne");
    ctx.root.querySelectorAll<HTMLButtonElement>(".category button")[0]!.click();
    await flush();
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "Chili con carne" });

    vi.mocked(window.prompt).mockReturnValueOnce(null);
    byText(ctx.root, "button", "Rename").click();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    byText(ctx.root.querySelectorAll(".category")[1]!, "button", "Delete category").click();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    byText(ctx.root.querySelectorAll(".category")[1]!, "button", "Delete category").click();
    await flush();
    expect(calls.find((c) => c.method === "DELETE")!.path).toBe("/api/categories/c2");

    byText(ctx.root, "button", "Add another category").click();
    expect(window.prompt).toHaveBeenLastCalledWith("Name the new category", "Dessert");
  });

  it("shows headings without edit buttons once closed", async () => {
    const data = view({ categories: [{ id: "c1", name: "Chili", position: 1 }, { id: "c2", name: "Dessert", position: 2 }] }, "closed");
    const { ctx } = await open(data);
    expect(ctx.root.querySelectorAll(".category-name")).toHaveLength(2);
    expect(ctx.root.textContent).not.toContain("Rename");
  });
});

describe("organizers (decision 16)", () => {
  it("lets the creator invite and remove co-organizers", async () => {
    const { ctx } = await open(view(), {
      "POST /api/events/e1/organizers": [201, { ok: true }],
      "DELETE /api/events/e1/organizers/kiana%40example.com": { ok: true },
    });
    expect(ctx.root.textContent).toContain("gary@example.com (created it)");
    byText(ctx.root, "button", "Remove").click();
    await flush();
    expect(calls.find((c) => c.method === "DELETE")!.path).toBe("/api/events/e1/organizers/kiana%40example.com");

    const invite = byText(ctx.root, "form", "Invite a co-organizer");
    fill(invite, "email", "shannon@example.com");
    submit(invite);
    await flush();
    expect(calls.find((c) => c.path === "/api/events/e1/organizers" && c.method === "POST")!.body).toEqual({ email: "shannon@example.com" });
  });

  it("hides creator-only controls from a co-organizer", async () => {
    const { ctx } = await open(view({ role: "co" }));
    expect(ctx.root.textContent).not.toContain("Invite a co-organizer");
    expect(ctx.root.textContent).not.toContain("Remove");
    expect(ctx.root.textContent).not.toContain("Delete this event");
  });
});

describe("share, edit and delete", () => {
  it("links the voting page, the code and both printouts", async () => {
    const { ctx } = await open(view());
    expect(byText(ctx.root, "a", "/v/e1").getAttribute("href")).toBe("/v/e1");
    expect(ctx.root.querySelector(".code")!.textContent).toBe("K7QM2X");
    expect(byText(ctx.root, "a", "Print the poster").getAttribute("href")).toBe("/e/e1/print/poster");
    expect(byText(ctx.root, "a", "Print the table cards").getAttribute("href")).toBe("/e/e1/print/cards");
  });

  it("saves a new name and date", async () => {
    const { ctx } = await open(view({ event: { id: "e1", code: "K", name: "Chili Night", date: null, status: "setup" } }), { "PATCH /api/events/e1": { ok: true } });
    const form = byText(ctx.root, "details", "Edit name or date").querySelector("form")!;
    expect((form.querySelector("[name=date]") as HTMLInputElement).value).toBe("");
    fill(form, "name", "Chili Bowl");
    submit(form);
    await flush();
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "Chili Bowl", date: "" });
  });

  it("deletes the event after confirming, then goes home", async () => {
    const { ctx } = await open(view(), { "DELETE /api/events/e1": { ok: true } });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    byText(ctx.root, "button", "Delete this event").click();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    byText(ctx.root, "button", "Delete this event").click();
    await flush();
    expect(ctx.navigate).toHaveBeenCalledWith("/");
  });
});
