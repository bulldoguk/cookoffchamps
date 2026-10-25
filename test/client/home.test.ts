import { afterEach, describe, expect, it, vi } from "vitest";
import { codeView, homeView } from "../../src/client/views/home";
import { byText, fakeApi, fill, flush, makeCtx, submit } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("home, logged out", () => {
  it("offers the code form and the login form", async () => {
    fakeApi({ "GET /api/me": [401, { error: "Please log in" }] });
    const ctx = makeCtx();
    await homeView(ctx);
    expect(byText(ctx.root, "h2", "Here to vote?")).toBeTruthy();
    expect(byText(ctx.root, "h2", "Running a cookoff?")).toBeTruthy();
    expect(ctx.root.querySelector(".error")).toBeNull();
    // The full hero, with the rosette as decoration only.
    const hero = ctx.root.querySelector(".hero")!;
    expect(hero.classList.contains("compact")).toBe(false);
    expect(hero.querySelector("h1")!.textContent).toBe("Cookoff Champs");
    expect(hero.querySelector("img")!.getAttribute("alt")).toBe("");
  });

  it("says when a login link has expired", async () => {
    fakeApi({ "GET /api/me": [401, {}] });
    const ctx = makeCtx("/?login=expired");
    await homeView(ctx);
    expect(ctx.root.querySelector(".error")!.textContent).toContain("expired");
  });

  it("goes to the typed code, tidied up", async () => {
    fakeApi({ "GET /api/me": [401, {}] });
    const ctx = makeCtx();
    await homeView(ctx);
    fill(ctx.root, "code", " k7qm2x ");
    submit(ctx.root.querySelector("form")!);
    expect(ctx.navigate).toHaveBeenCalledWith("/c/K7QM2X");
  });

  it("sends a login link and says where it went", async () => {
    const calls = fakeApi({ "GET /api/me": [401, {}], "POST /api/auth/login": { ok: true } });
    const ctx = makeCtx();
    await homeView(ctx);
    fill(ctx.root, "email", "gary@example.com");
    submit(ctx.root.querySelectorAll("form")[1]!);
    await flush();
    expect(calls.at(-1)).toEqual({ method: "POST", path: "/api/auth/login", body: { email: "gary@example.com" } });
    expect(ctx.root.querySelector(".status")!.textContent).toContain("Check gary@example.com");
  });

  it("shows the server's error, or a generic one when offline", async () => {
    fakeApi({ "GET /api/me": [401, {}], "POST /api/auth/login": [400, { error: "A valid email address is required" }] });
    const ctx = makeCtx();
    await homeView(ctx);
    const form = ctx.root.querySelectorAll("form")[1]!;
    submit(form);
    await flush();
    expect(ctx.root.querySelector(".status")!.textContent).toBe("A valid email address is required");

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    submit(form);
    await flush();
    expect(ctx.root.querySelector(".status")!.textContent).toBe("Couldn't send the link. Try again.");
  });

  it("lets other failures surface", async () => {
    fakeApi({ "GET /api/me": [500, { error: "boom" }] });
    await expect(homeView(makeCtx())).rejects.toMatchObject({ status: 500 });
  });
});

describe("home, logged in", () => {
  const events = [
    { id: "e1", code: "AAA", name: "Chili Night", date: "2026-11-01", status: "open", role: "creator" },
    { id: "e2", code: "BBB", name: "Pie Off", date: null, status: "revealed", role: "co" },
  ];

  it("lists my events with their status and role", async () => {
    fakeApi({ "GET /api/me": { email: "g@example.com" }, "GET /api/events": { events } });
    const ctx = makeCtx();
    await homeView(ctx);
    expect(ctx.root.textContent).toContain("Logged in as g@example.com");
    expect(ctx.root.querySelector(".hero")!.classList.contains("compact")).toBe(true);
    const items = [...ctx.root.querySelectorAll(".events li")].map((li) => li.textContent);
    expect(items).toEqual(["Chili Night Sunday, November 1, 2026 · Voting open", "Pie Off Results out · co-organizer"]);
    expect(ctx.root.querySelector(".events time")!.getAttribute("datetime")).toBe("2026-11-01");
    expect(ctx.root.querySelector<HTMLAnchorElement>(".events a")!.getAttribute("href")).toBe("/e/e1");
  });

  it("says when there are none yet", async () => {
    fakeApi({ "GET /api/me": { email: "g@example.com" }, "GET /api/events": { events: [] } });
    const ctx = makeCtx();
    await homeView(ctx);
    expect(ctx.root.textContent).toContain("None yet.");
  });

  it("creates an event and opens it", async () => {
    const calls = fakeApi({
      "GET /api/me": { email: "g@example.com" },
      "GET /api/events": { events: [] },
      "POST /api/events": [201, { id: "new1", code: "XYZ" }],
    });
    const ctx = makeCtx();
    await homeView(ctx);
    fill(ctx.root, "name", "Chili Night");
    fill(ctx.root, "date", "2026-11-01");
    submit(ctx.root.querySelector("form")!);
    await flush();
    expect(calls.at(-1)!.body).toEqual({ name: "Chili Night", date: "2026-11-01" });
    expect(ctx.navigate).toHaveBeenCalledWith("/e/new1");
  });

  it("shows why creating failed", async () => {
    fakeApi({
      "GET /api/me": { email: "g@example.com" },
      "GET /api/events": { events: [] },
      "POST /api/events": [400, { error: "name is required" }],
    });
    const ctx = makeCtx();
    await homeView(ctx);
    submit(ctx.root.querySelector("form")!);
    await flush();
    expect(ctx.root.querySelector(".status")!.textContent).toBe("name is required");
  });

  it("logs out", async () => {
    const calls = fakeApi({ "GET /api/me": { email: "g@example.com" }, "GET /api/events": { events: [] }, "POST /api/auth/logout": { ok: true } });
    const ctx = makeCtx();
    await homeView(ctx);
    byText(ctx.root, "button", "Log out").click();
    await flush();
    expect(calls.at(-1)!.path).toBe("/api/auth/logout");
    expect(ctx.navigate).toHaveBeenCalledWith("/");
  });
});

describe("code lookup page", () => {
  it("goes straight to the vote page", async () => {
    const calls = fakeApi({ "GET /api/public/codes/K7%2FX": { id: "e1" } });
    const ctx = makeCtx();
    await codeView(ctx, "K7/X");
    expect(calls[0]!.path).toBe("/api/public/codes/K7%2FX");
    expect(ctx.navigate).toHaveBeenCalledWith("/v/e1");
  });

  it("explains an unknown code", async () => {
    fakeApi({});
    const ctx = makeCtx();
    await codeView(ctx, "NOPE");
    expect(ctx.root.querySelector("h1")!.textContent).toBe("No such code");
    expect(ctx.root.textContent).toContain("the code NOPE");
  });

  it("lets other failures surface", async () => {
    fakeApi({ "GET /api/public/codes/X": [500, {}] });
    await expect(codeView(makeCtx(), "X")).rejects.toMatchObject({ status: 500 });
  });
});
