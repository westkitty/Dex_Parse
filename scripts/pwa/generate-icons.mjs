#!/usr/bin/env node
/**
 * Render DexParse's install icons from public/icons/icon.svg (an original
 * drawing that extends public/favicon.svg). Re-run after changing the SVG:
 *
 *   node scripts/pwa/generate-icons.mjs
 *
 * Needs Chrome/Chromium (CHROME_PATH, default /usr/bin/google-chrome) and the
 * playwright devDependency. Outputs are committed, so builds do not need Chrome.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, "public", "icons");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? "";
// Artwork without the rounded background tile.
const art = svg
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(defs, "")
  .replace(/<rect width="512" height="512"[^>]*\/>/, "");
const fullBleed = (scale) => {
  const offset = (512 * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${art}</g>
</svg>`;
};
// Maskable: full-bleed background, artwork inside the 80% safe zone.
const maskable = fullBleed(0.72);
// Apple touch icon: opaque square (iOS rounds the corners itself).
const apple = fullBleed(0.9);

const jobs = [
  ["icon-192.png", svg, 192, true],
  ["icon-512.png", svg, 512, true],
  ["maskable-192.png", maskable, 192, false],
  ["maskable-512.png", maskable, 512, false],
  ["apple-touch-icon.png", apple, 180, false],
];
writeFileSync(join(dir, "maskable.svg"), maskable + "\n");

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome" });
try {
  for (const [name, markup, size, transparent] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${markup.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: join(dir, name), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`wrote public/icons/${name} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
