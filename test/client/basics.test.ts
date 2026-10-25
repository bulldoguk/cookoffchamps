import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../src/client/api";
import { h, mount, ordinal, photoUrl } from "../../src/client/dom";
import { fitWithin, resizePhoto } from "../../src/client/photo";
import { qrSvg, renderQr } from "../../src/client/qr";
import { getTurnstileToken, loadTurnstile, resetTurnstileLoader } from "../../src/client/turnstile";
import { fakeApi } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("h and mount", () => {
  it("sets attributes, listeners and text children", () => {
    const onclick = vi.fn();
    const el = h("button", { class: "x", disabled: true, hidden: false, title: undefined, onclick, "data-n": 3 }, "Go ", 2, null, false, undefined, h("b", {}, "!"));
    expect(el.outerHTML).toBe('<button class="x" disabled="" data-n="3">Go 2<b>!</b></button>');
    // A disabled button swallows clicks, so check the listener on an enabled one.
    const live = h("button", { onclick });
    live.click();
    expect(onclick).toHaveBeenCalledOnce();
  });

  it("never parses text as HTML", () => {
    expect(h("p", {}, "<img src=x onerror=alert(1)>").children).toHaveLength(0);
  });

  it("mounts nodes, skipping nulls", () => {
    const root = document.createElement("div");
    root.append("old");
    mount(root, h("p"), null, h("span"));
    expect(root.innerHTML).toBe("<p></p><span></span>");
  });

  it("builds photo URLs and ordinals", () => {
    expect(photoUrl("events/a/b")).toBe("/api/photos/events/a/b");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"],
    );
  });
});

describe("api", () => {
  it("GETs JSON by default", async () => {
    const calls = fakeApi({ "GET /api/me": { email: "a@b.co" } });
    expect(await api("/api/me")).toEqual({ email: "a@b.co" });
    expect(calls[0]).toMatchObject({ method: "GET", body: undefined });
  });

  it("sends objects as JSON and FormData as-is", async () => {
    const calls = fakeApi({ "POST /x": { ok: 1 } });
    await api("/x", { method: "POST", body: { a: 1 } });
    const form = new FormData();
    await api("/x", { method: "POST", body: form });
    expect(calls[0]!.body).toEqual({ a: 1 });
    expect(calls[1]!.body).toBe(form);
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(vi.mocked(fetch).mock.calls[1]![1]!.headers).toBeUndefined();
  });

  it("throws ApiError with the server's message, or a default", async () => {
    fakeApi({ "GET /bad": [409, { error: "Nope" }] });
    await expect(api("/bad")).rejects.toMatchObject({ status: 409, message: "Nope" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 502 })));
    const err = await api("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, message: "Something went wrong" });
  });

  it("treats a non-JSON success body as empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    expect(await api("/x")).toEqual({});
  });
});

describe("photo resizing", () => {
  it("fits the long edge within the limit, never enlarging", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });

  function fakeCanvas(blob: Blob | null) {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => {
        expect([type, quality]).toEqual(["image/jpeg", 0.82]);
        cb(blob);
      },
    } as unknown as HTMLCanvasElement;
    return { canvas, drawImage };
  }

  it("draws the image at the new size and returns a JPEG", async () => {
    const out = new Blob(["jpeg"]);
    const { canvas, drawImage } = fakeCanvas(out);
    const close = vi.fn();
    const image = { width: 4000, height: 2000, close } as never;
    const result = await resizePhoto(new Blob(["x"]), { decode: async () => image, canvas: () => canvas });
    expect(result).toBe(out);
    expect([canvas.width, canvas.height]).toEqual([1600, 800]);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 1600, 800);
    expect(close).toHaveBeenCalled();
  });

  it("copes with an image that can't be closed, and fails when encoding fails", async () => {
    const { canvas } = fakeCanvas(null);
    await expect(
      resizePhoto(new Blob(["x"]), { decode: async () => ({ width: 10, height: 10 }) as never, canvas: () => canvas }),
    ).rejects.toThrow("Could not process that photo");
  });

  it("uses createImageBitmap and a real canvas by default", async () => {
    const bitmap = { width: 20, height: 10, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["ok"])));
    const out = await resizePhoto(new Blob(["x"]));
    expect(await out.text()).toBe("ok");
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
  });
});

describe("QR codes", () => {
  it("renders an SVG for a URL", async () => {
    expect(await qrSvg("https://cookoffchamps.com/v/abc")).toMatch(/^<svg/);
    const el = document.createElement("div");
    await renderQr(el, "hi");
    expect(el.querySelector("svg")).not.toBeNull();
  });
});

describe("Turnstile", () => {
  afterEach(() => {
    delete window.turnstile;
    resetTurnstileLoader();
    document.head.replaceChildren();
  });

  function fakeTurnstile(outcome: "ok" | "error") {
    const api = {
      render: vi.fn((_el: HTMLElement, opts: Record<string, (t?: string) => void>) => {
        queueMicrotask(() => (outcome === "ok" ? opts.callback!("token-1") : opts["error-callback"]!()));
        return "w1";
      }),
      execute: vi.fn(),
      remove: vi.fn(),
    };
    return api;
  }

  it("uses an already-loaded Turnstile", async () => {
    window.turnstile = fakeTurnstile("ok");
    expect(await loadTurnstile()).toBe(window.turnstile);
    expect(document.head.querySelector("script")).toBeNull();
  });

  it("loads the script once, even when asked twice", async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    const scripts = document.head.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toContain("challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    window.turnstile = fakeTurnstile("ok");
    scripts[0]!.onload!(new Event("load"));
    expect(await first).toBe(window.turnstile);
    expect(await second).toBe(window.turnstile);
  });

  it("can retry after the script fails to load", async () => {
    const first = loadTurnstile();
    document.head.querySelector("script")!.onerror!(new Event("error"));
    await expect(first).rejects.toThrow("Couldn't load the vote check");
    void loadTurnstile();
    expect(document.head.querySelectorAll("script")).toHaveLength(2);
  });

  it("gets a token and removes the widget", async () => {
    const t = fakeTurnstile("ok");
    window.turnstile = t;
    const box = document.createElement("div");
    expect(await getTurnstileToken("site", box)).toBe("token-1");
    expect(t.render).toHaveBeenCalledWith(box, expect.objectContaining({ sitekey: "site", execution: "execute" }));
    expect(t.execute).toHaveBeenCalledWith("w1");
    expect(t.remove).toHaveBeenCalledWith("w1");
  });

  it("rejects when the check fails", async () => {
    window.turnstile = fakeTurnstile("error");
    await expect(getTurnstileToken("site", document.createElement("div"))).rejects.toThrow("The vote check failed");
    expect(window.turnstile.remove).toHaveBeenCalledWith("w1");
  });
});
