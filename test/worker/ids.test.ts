import { describe, expect, it } from "vitest";
import { newCode, newId } from "../../src/worker/ids";

describe("newId", () => {
  it("is 22 URL-safe characters and not repeated", () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("newCode", () => {
  it("uses only unambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  it("takes a length", () => {
    expect(newCode(4)).toHaveLength(4);
  });
});
