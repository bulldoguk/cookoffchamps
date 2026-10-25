import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import path from "node:path";

const PHOTO = path.join(import.meta.dirname, "fixtures", "dish.png");

/** Logs in through the real magic-link flow, reading the link from the dev outbox. */
async function login(page: Page, request: APIRequestContext, email: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText(`Check ${email}`)).toBeVisible();
  const outbox = await (await request.get("/api/dev/outbox")).json();
  const mail = outbox.find((m: { to: string }) => m.to === email);
  const link = mail.body.match(/https?:\/\/\S+/)[0];
  await page.goto(link);
  await expect(page.getByText(`Logged in as ${email}`)).toBeVisible();
}

async function addDish(page: Page, cook: string, dish: string): Promise<void> {
  const form = page.locator(".entry-form").last();
  await form.getByLabel("Cook").fill(cook);
  await form.getByLabel("Dish").fill(dish);
  await form.getByLabel("Photo").setInputFiles(PHOTO);
  await form.getByRole("button", { name: "Add" }).click();
  await expect(page.locator(".entry", { hasText: dish })).toBeVisible();
}

test("a whole cookoff: set up, print, vote blind, reveal 3-2-1, results", async ({ page, browser, request }) => {
  const email = `host-${Date.now()}@example.com`;
  await login(page, request, email);

  // Set up the event and its dishes.
  await page.getByLabel("Name").fill("Bailey Chili Cookoff");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Bailey Chili Cookoff" })).toBeVisible();
  const eventId = page.url().split("/e/")[1]!;

  await addDish(page, "Grandma", "Texas red");
  await addDish(page, "Kiana", "White chicken chili");
  await addDish(page, "Shannon", "Chili verde");
  await expect(page.locator(".entry img")).toHaveCount(3);

  // Both printouts render their QR codes.
  await page.getByRole("link", { name: "Print the poster" }).click();
  await expect(page.locator(".poster .qr svg")).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: "Print the table cards" }).click();
  await expect(page.locator(".tent-card")).toHaveCount(3);
  await expect(page.locator(".tent-card").first()).not.toContainText("Grandma");
  await page.goBack();

  await page.getByRole("button", { name: "Open voting" }).click();
  await expect(page.getByText("Voting is open.")).toBeVisible();

  // Four guests, each on their own phone. Blind: no cook names anywhere.
  const ballots = ["Chili verde", "Chili verde", "White chicken chili", "Texas red"];
  for (const [i, dish] of ballots.entries()) {
    const phone = await browser.newContext();
    const guest = await phone.newPage();
    await guest.goto(`/v/${eventId}`);
    await expect(guest.getByText("Tap your favourite dish.")).toBeVisible();
    await expect(guest.locator("main")).not.toContainText("Grandma");
    if (i === 3) {
      // The last guest changes their mind (decision 14): still one vote.
      await guest.locator(".dish", { hasText: "Chili verde" }).click();
      await expect(guest.getByText("Vote saved. Thanks!")).toBeVisible();
    }
    await guest.locator(".dish", { hasText: dish }).click();
    await expect(guest.locator(".dish.chosen")).toContainText(dish);
    await phone.close();
  }

  // The organizer sees the count, can peek, then closes voting.
  await expect(page.getByTestId("votes-cast")).toHaveText("4", { timeout: 15_000 });
  await page.getByRole("button", { name: "Peek at the standings" }).click();
  await expect(page.locator(".peek li").first()).toContainText("Chili verde (Shannon): 2");
  await page.getByRole("button", { name: "Close voting" }).click();

  // Closed but not revealed: guests still see no results.
  const later = await (await browser.newContext()).newPage();
  await later.goto(`/v/${eventId}`);
  await expect(later.getByText("The results are coming soon!")).toBeVisible();

  // The reveal: 2nd is a tie, so it's one click, then the champion.
  await page.getByRole("link", { name: "Start the reveal" }).click();
  const stage = page.locator(".reveal");
  await stage.click();
  await expect(stage.locator(".place")).toHaveText("2nd place (tied)");
  await expect(stage.locator(".cook")).toHaveText(["Grandma", "Kiana"]);
  await stage.click();
  await expect(stage.locator(".place")).toHaveText("Champion!");
  await expect(stage.locator(".cook")).toHaveText("Shannon");

  // The same QR link now shows the results.
  await expect(async () => {
    await later.reload();
    await expect(later.locator(".place").first()).toHaveText("1st place");
  }).toPass();
  await expect(later.locator(".results")).toContainText("by Shannon");
  await expect(later.locator(".results")).toContainText("2 votes");
});

test("the typed code finds the event", async ({ page, request }) => {
  await login(page, request, `code-${Date.now()}@example.com`);
  await page.getByLabel("Name").fill("Pie Off");
  await page.getByRole("button", { name: "Create" }).click();
  const code = await page.locator(".code").textContent();

  await page.goto("/");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Running a cookoff?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hosted in the Barn" })).toHaveAttribute("href", "https://hostedinthebarn.com");
  await page.getByLabel("Type the code from the poster").fill(code!.toLowerCase());
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page.getByRole("heading", { name: "Pie Off" })).toBeVisible();
  await expect(page.getByText("Voting hasn't opened yet.")).toBeVisible();
});

test("the favicon, touch icon and manifest are served and linked", async ({ page, request }) => {
  await page.goto("/");
  for (const [rel, type] of [["icon", "image/svg+xml"], ["apple-touch-icon", "image/png"], ["manifest", "application/manifest+json"]]) {
    const href = await page.locator(`link[rel="${rel}"]`).first().getAttribute("href");
    const res = await request.get(href!);
    expect(res.status(), href!).toBe(200);
    expect(res.headers()["content-type"], href!).toContain(type);
  }
  const manifest = await (await request.get("/site.webmanifest")).json();
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  expect((await request.get("/favicon-32.png")).status()).toBe(200);
});
