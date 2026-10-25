import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const call = (path: string) => exports.default.fetch(`https://example.com${path}`);

describe("worker routing", () => {
  it("reports health once the database answers", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("hands everything else to the static assets", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Cookoff Champs");
  });
});
