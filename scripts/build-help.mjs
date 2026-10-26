// Writes the public help pages (SW-24) into public/ at build time:
//   public/help/index.html, public/help/filter.js, public/sitemap.xml, public/robots.txt
// The words come from src/help/content.ts and the HTML from src/help/render.ts;
// esbuild bundles them so plain Node can run them. Run by `npm run build`.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.join(import.meta.dirname, "..");
const pub = path.join(root, "public");
const tmp = path.join(root, ".wrangler", "help-build.mjs");

await build({
  stdin: {
    contents: `export { helpPage, sitemap, robots } from "./src/help/render.ts"; export { en } from "./src/help/content.ts";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: tmp,
  logLevel: "warning",
});
const { helpPage, sitemap, robots, en } = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`);

fs.mkdirSync(path.join(pub, "help"), { recursive: true });
fs.writeFileSync(path.join(pub, "help", "index.html"), helpPage(en));
fs.writeFileSync(path.join(pub, "sitemap.xml"), sitemap());
fs.writeFileSync(path.join(pub, "robots.txt"), robots());

await build({
  entryPoints: [path.join(root, "src/help/filter-main.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  outfile: path.join(pub, "help", "filter.js"),
  logLevel: "warning",
});
console.log("help pages written");
