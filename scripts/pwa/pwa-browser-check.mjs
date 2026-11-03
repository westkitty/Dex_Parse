#!/usr/bin/env node
/**
 * Real-browser PWA check against a production build served on localhost.
 *
 *   npm run build && npm run preview &      # serves http://127.0.0.1:8081
 *   node scripts/pwa/pwa-browser-check.mjs [--url http://127.0.0.1:8081] [--shots dir] [--update-file path/to/static/sw.js]
 *
 * Checks, in headless Chrome: no console errors, the manifest Chrome parses,
 * Chrome's own installability verdict (Page.getInstallabilityErrors), service
 * worker control, a full reload and a parse with the network OFF, the
 * DexDiffusion tab offline, and (with --update-file) the update banner flow by
 * publishing a new sw.js version and pressing "Reload to update".
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.url || "http://127.0.0.1:8081";
const SHOTS = args.shots || "";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, name) });

// A persistent (non-incognito) profile: Chrome never offers install in incognito.
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "dexparse-pwa-")), {
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  viewport: { width: 1360, height: 860 },
  serviceWorkers: "allow",
  acceptDownloads: true,
});
await context.addInitScript(() => {
  try {
    localStorage.removeItem("dexparse.script.v1");
  } catch {
    /* ignore */
  }
});
const page = context.pages()[0] ?? (await context.newPage());
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/grok-app-builder\/extensions\.js|ERR_INTERNET_DISCONNECTED/.test(m.text())) consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
check("service worker registered and controlling the page", controlled);
const version = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => resolve(e.data.version);
      navigator.serviceWorker.controller?.postMessage({ type: "GET_VERSION" }, [ch.port2]);
      setTimeout(() => resolve(null), 2000);
    }),
);
check("service worker reports its cache version", typeof version === "string" && version.length === 12, String(version));
const cacheNames = await page.evaluate(() => caches.keys());
check("versioned cache created", cacheNames.includes(`dexparse-${version}`), cacheNames.join(", "));

const cdp = await context.newCDPSession(page);
const manifest = await cdp.send("Page.getAppManifest");
const parsed = JSON.parse(manifest.data || "{}");
check("Chrome parsed the manifest without errors", manifest.errors.length === 0 && parsed.name === "DexParse", manifest.errors.map((e) => e.message).join("; "));
const installability = await cdp.send("Page.getInstallabilityErrors");
check(
  "Chrome reports DexParse installable (no installability errors)",
  installability.installabilityErrors.length === 0,
  installability.installabilityErrors.map((e) => e.errorId).join(", ") || "none",
);
check("maskable 512 icon declared", (parsed.icons || []).some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
check("apple-touch-icon link present", appleIcon === "/icons/apple-touch-icon.png", appleIcon);
check("only one manifest link", (await page.locator('link[rel="manifest"]').count()) === 1);

// Load a script with known DexDiffusion differences, parse, inspect the DexDiffusion tab.
const divergent = readFileSync(new URL("../../src/lib/dexparse/dexdiffusion/fixtures/divergent.txt", import.meta.url), "utf8");
const parseScript = async (p, text) => {
  const area = p.locator("textarea[data-script]:visible").first();
  await area.fill(text);
  await p.getByRole("button", { name: /^Parse/ }).click();
  await p.waitForFunction(
    () => !/Source changed/.test(document.querySelector('[data-testid="validation-status"]')?.textContent ?? "Source changed"),
    null,
    { timeout: 10000 },
  );
};
await parseScript(page, divergent);
await page.getByTestId("tab-dexdiffusion").first().click();
const issues = await page.getByTestId("dexdiffusion-issues").first().locator("li").count();
check("DexDiffusion tab lists grammar differences", issues >= 5, `${issues} differences`);
await shot(page, "dexparse-dexdiffusion-tab.png");

// Offline: reload the whole app with the network off.
await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /^Parse/ }).waitFor({ timeout: 10000 });
check("app shell reloads with the network off", await page.getByText("Offline script classification").isVisible());
const networkOff = await page.evaluate(() =>
  fetch("/api/__dexparse_offline_probe", { cache: "no-store" }).then(
    () => false,
    () => true,
  ),
);
check("network really is off for this reload (uncached request fails)", networkOff);
// Playwright's offline emulation does not always flip navigator.onLine, so fire the
// browser's own "offline" event if needed; the badge listens for exactly that event.
if (await page.evaluate(() => navigator.onLine)) await page.evaluate(() => window.dispatchEvent(new Event("offline")));
await page.getByTestId("offline-badge").waitFor({ timeout: 5000 }).catch(() => {});
check("offline badge shown", await page.getByTestId("offline-badge").isVisible());
const studio = readFileSync(new URL("../../src/lib/dexparse/dexdiffusion/fixtures/studio-drama.txt", import.meta.url), "utf8");
await parseScript(page, studio);
const status = await page.getByTestId("validation-status").first().innerText();
check("parsing works offline (lazy parser worker served from cache)", /classified/.test(status), status.split("\n")[0]);
await page.getByTestId("tab-dexdiffusion").first().click();
const ddStatus = await page.getByTestId("dexdiffusion-status").first().innerText();
check("DexDiffusion check works offline", /Ready for DexDiffusion/.test(ddStatus), ddStatus.split("\n")[0]);
const download = page.waitForEvent("download");
await page.getByTestId("export-dexdiffusion").first().click();
const file = await download;
const body = JSON.parse(readFileSync(await file.path(), "utf8"));
check(
  "Export for DexDiffusion writes the POST /api/drama/projects body",
  body.script === studio && body.mode === "deterministic" && body.settings.narrator_name === "NARRATOR",
  file.suggestedFilename(),
);
await shot(page, "dexparse-offline.png");
await context.setOffline(false);

// Update flow: publish a new sw.js, let the page find it, press the banner.
if (args["update-file"]) {
  const swPath = args["update-file"];
  const original = readFileSync(swPath, "utf8");
  const bumped = original.replace(/const VERSION = "([0-9a-f]+)";/, (_m, v) => `const VERSION = "${v.slice(0, 6)}update";`);
  writeFileSync(swPath, bumped);
  try {
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await page.getByTestId("update-banner").waitFor({ timeout: 15000 });
    check("update banner appears when a new version is waiting", true);
    await shot(page, "dexparse-update-banner.png");
    await Promise.all([page.waitForEvent("load", { timeout: 15000 }), page.getByRole("button", { name: "Reload to update" }).click()]);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
    const after = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const ch = new MessageChannel();
          ch.port1.onmessage = (e) => resolve(e.data.version);
          navigator.serviceWorker.controller?.postMessage({ type: "GET_VERSION" }, [ch.port2]);
          setTimeout(() => resolve(null), 2000);
        }),
    );
    check("Reload to update activates the new version", after && after.endsWith("update"), String(after));
    const keys = await page.evaluate(() => caches.keys());
    check("old cache deleted after update", !keys.includes(`dexparse-${version}`) && keys.length === 1, keys.join(", "));
  } finally {
    writeFileSync(swPath, original);
  }
}

// Phone-sized layout still loads from the cache.
const p2 = await context.newPage();
await p2.setViewportSize({ width: 390, height: 844 });
await p2.goto(BASE + "/", { waitUntil: "networkidle" });
check("phone-width layout renders", await p2.getByRole("button", { name: /^Parse/ }).isVisible());
await p2.close();

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
await context.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PWA checks passed`);
process.exit(failed.length ? 1 : 0);
