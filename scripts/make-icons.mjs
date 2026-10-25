// Renders the PNG icons from public/favicon.svg with Playwright's Chromium, so
// the SVG stays the single source. Run after changing the SVG:
//   node scripts/make-icons.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const pub = path.join(import.meta.dirname, "..", "public");
const svg = fs.readFileSync(path.join(pub, "favicon.svg"), "utf8");
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const CREAM = "#fffaf3";

// [file, canvas px, rosette px, background]. Home-screen icons get the cream
// page colour, and the rosette sits inside the maskable safe zone (80%).
const ICONS = [
  ["favicon-32.png", 32, 32, null],
  ["apple-touch-icon.png", 180, 132, CREAM],
  ["icon-192.png", 192, 120, CREAM],
  ["icon-512.png", 512, 320, CREAM],
];

const browser = await chromium.launch();
const page = await browser.newPage({ colorScheme: "light" });
for (const [file, size, inner, bg] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg ?? "transparent"}">` +
      `<img src="${src}" width="${inner}" height="${inner}"></body>`,
  );
  await page.screenshot({ path: path.join(pub, file), omitBackground: bg === null });
  console.log(file);
}
await browser.close();
