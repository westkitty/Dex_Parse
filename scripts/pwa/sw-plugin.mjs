/**
 * Emits /sw.js into the client build. The precache list is every file the
 * client bundle produced plus the app shell ("/"), the manifest, icons and the
 * offline page; the cache version is a hash of that list and of the template,
 * so any change to the app ships a new cache and old caches are deleted.
 *
 * Dev (`vite dev`) serves no worker; the page only registers it in production.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(here, "sw-template.js");

/** Public files worth precaching (not the iOS install tutorial assets). */
export function publicPrecache(publicDir) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push("/" + relative(publicDir, full).split(sep).join("/"));
    }
  };
  try {
    walk(publicDir);
  } catch {
    return [];
  }
  return out.filter((p) => !p.startsWith("/__grok/install/") && !p.endsWith(".map")).sort();
}

export function renderServiceWorker(template, urls) {
  const list = [...new Set(urls)].sort();
  const version = createHash("sha256").update(template).update(JSON.stringify(list)).digest("hex").slice(0, 12);
  return {
    version,
    source: template
      .replace(/^\/\* global __DEXPARSE_SW_PRECACHE__ \*\/\n/m, "")
      .replaceAll("__DEXPARSE_SW_VERSION__", version)
      .replaceAll("__DEXPARSE_SW_PRECACHE__", JSON.stringify(list, null, 2)),
  };
}

export function dexParseServiceWorker() {
  let publicDir = "";
  return {
    name: "dexparse:service-worker",
    apply: "build",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((file) => !file.endsWith(".map") && file !== "sw.js" && !file.endsWith(".vite/manifest.json"))
        .map((file) => "/" + file);
      // Root-relative here; the worker resolves each against its own scope, so the
      // same sw.js works at "/" (local) and "/Dex_Parse/" (GitHub Pages).
      const urls = ["/", ...publicPrecache(publicDir), ...built];
      const { source, version } = renderServiceWorker(readFileSync(TEMPLATE, "utf8"), urls);
      this.emitFile({ type: "asset", fileName: "sw.js", source });
      this.info?.(`sw.js ${version}: ${urls.length} precached URLs`);
    },
  };
}
