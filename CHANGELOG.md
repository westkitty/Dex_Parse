# Changelog

## 1.2.0 · 2026-11-03

### Added

- **GitHub Pages.** DexParse is live at https://westkitty.github.io/Dex_Parse/. `.github/workflows/pages.yml` runs the tests, builds with `npm run build:pages` and deploys on every push to `main` (and on manual dispatch).
- `npm run build:pages`: a static build with the base path `/Dex_Parse/` and a prerendered `index.html`, written to `dist-pages/` so the committed local build is untouched.

### Changed

- The app works from any base path. The manifest's `id`, `start_url`, `scope` and icon paths are relative, the service worker resolves its shell, precache, offline page and `/api/` bypass against its own scope, the page registers `<base>sw.js` with scope `<base>`, and head links use Vite's `BASE_URL`. Local use (`npm run app` on `http://127.0.0.1:8081`) is unchanged.
- The headless Chrome PWA check accepts a subpath `--url`.

## 1.1.0 · 2026-11-02

### Added

- **Installable, offline PWA.** DexParse now has its own web app manifest (name, 192/512 icons, maskable icons, Apple touch icon, standalone display, dark theme colours) and a service worker generated at build time. The service worker precaches the app shell, every built asset (including the parser worker), the icons and an offline page. The cache is versioned by content, so each build replaces the previous cache and deletes the old one.
- **Update flow.** A new build is downloaded in the background. A banner says "A new version of DexParse is ready", and **Reload to update** switches to it. The script in the editor is kept in local storage.
- **Install button** where the browser offers installation (Chrome, Edge). **Offline badge** while the network is down. Parsing never needed the network and still does not.
- **DexDiffusion compatibility.** There is a new **DexDiffusion** results tab, a faithful port of DexDiffusion's Drama (Audio > Script) parser, **Export for DexDiffusion** (the exact `POST /api/drama/projects` body), and import of DexDiffusion drama projects and request files. See [docs/DEXDIFFUSION.md](docs/DEXDIFFUSION.md).
- **`bin/dexparse-dexdiffusion.mjs` CLI** with `parse`, `coverage`, `request`, `status`, `verify` and `send` for DexDiffusion's Drama API on `127.0.0.1:31337` or a tailnet host.
- `npm run app` builds and serves the production app on `http://127.0.0.1:8081`, the installable local PWA.
- Tests: golden fixtures from the real DexDiffusion parser, round-trip export → DexDiffusion project tests, a live parity fuzz test when Image_Gen is checked out alongside, CLI tests against a stand-in server, manifest, icon and service-worker tests, and `scripts/pwa/pwa-browser-check.mjs` for headless Chrome installability, offline reload and update checks.

### Changed

- The platform head injector no longer adds the generic `/__grok/manifest.webmanifest` when the page already declares its own manifest or touch icon.
- `--color-subtle` is lighter (`#828b95`), so small text meets WCAG AA contrast. The hidden file input has a label.
- Fixed four existing lint errors.
