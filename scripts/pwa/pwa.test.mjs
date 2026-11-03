import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { publicPrecache, renderServiceWorker } from "./sw-plugin.mjs";
import { injectGrokPwaHead } from "../grok-pwa-shared.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicDir = join(root, "public");
const manifest = JSON.parse(readFileSync(join(publicDir, "manifest.webmanifest"), "utf8"));
const template = readFileSync(join(root, "scripts/pwa/sw-template.js"), "utf8");

function pngSize(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString("ascii", 1, 4), "PNG", `${file} is not a PNG`);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe("web app manifest", () => {
  it("has the fields Chrome needs to install DexParse", () => {
    assert.equal(manifest.name, "DexParse");
    assert.equal(manifest.short_name, "DexParse");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.scope, "/");
    assert.ok(manifest.start_url.startsWith("/"));
    assert.equal(manifest.id, "/");
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  });

  it("ships real 192 and 512 icons, both any and maskable", () => {
    for (const purpose of ["any", "maskable"])
      for (const size of ["192x192", "512x512"]) {
        const icon = manifest.icons.find((i) => i.purpose === purpose && i.sizes === size);
        assert.ok(icon, `${purpose} ${size}`);
        const file = join(publicDir, icon.src);
        assert.ok(existsSync(file), file);
        assert.equal(pngSize(file), size);
      }
    assert.equal(pngSize(join(publicDir, "icons/apple-touch-icon.png")), "180x180");
  });
});

describe("service worker build", () => {
  it("precaches public files except the iOS install tutorial", () => {
    const list = publicPrecache(publicDir);
    assert.ok(list.includes("/manifest.webmanifest"));
    assert.ok(list.includes("/offline.html"));
    assert.ok(list.includes("/icons/maskable-512.png"));
    assert.ok(!list.some((p) => p.startsWith("/__grok/install/")));
  });

  it("versions the cache by content so every build change invalidates old caches", () => {
    const a = renderServiceWorker(template, ["/", "/assets/a-1.js"]);
    const b = renderServiceWorker(template, ["/assets/a-1.js", "/"]);
    const c = renderServiceWorker(template, ["/", "/assets/a-2.js"]);
    assert.equal(a.version, b.version);
    assert.notEqual(a.version, c.version);
    assert.ok(!a.source.includes("__DEXPARSE_SW_"));
    assert.match(a.source, new RegExp(`const VERSION = "${a.version}"`));
  });

  it("is valid script whose handlers cover install, activate, fetch and update messages", () => {
    const { source } = renderServiceWorker(template, ["/", "/offline.html"]);
    const events = [];
    const sandbox = {
      self: { addEventListener: (type) => events.push(type), registration: {}, location: { origin: "http://127.0.0.1" } },
      caches: {},
      URL,
      Request: class {},
      Response: { error: () => null },
      setTimeout,
    };
    vm.runInNewContext(source, sandbox);
    assert.deepEqual(events.sort(), ["activate", "fetch", "install", "message"]);
    assert.match(source, /SKIP_WAITING/);
    assert.match(source, /k\.startsWith\(PREFIX\) && k !== CACHE/);
    assert.match(source, /\/api\//, "API calls must never be cached");
  });
});

describe("platform head injector", () => {
  it("does not add the generic Grok manifest when the app has its own", () => {
    const html = '<html><head><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"></head><body></body></html>';
    const out = injectGrokPwaHead(html, { host: "localhost", site: {} });
    assert.equal((out.match(/rel="manifest"/g) || []).length, 1);
    assert.equal((out.match(/rel="apple-touch-icon"/g) || []).length, 1);
    assert.ok(!out.includes("/__grok/manifest.webmanifest"));
  });

  it("still adds it to documents that have none", () => {
    const out = injectGrokPwaHead("<html><head></head><body></body></html>", { host: "localhost", site: {} });
    assert.ok(out.includes('href="/__grok/manifest.webmanifest"'));
  });
});
