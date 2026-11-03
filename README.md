# DexParse

Offline script parser. Paste a script, classify it with explicit grammar, check that every character is accounted for, and export JSON. The original text is authoritative and is never rewritten.

## This release

A native SwiftUI app was the preferred build. This environment is Debian without Xcode or a Swift toolchain (`swift` is not installed), so the working release is a local-first desktop-style app:

- The deterministic parser is plain TypeScript.
- Parsing does not use a network call, an account, or a model.
- Optional Ollama help talks only to `localhost`, `127.0.0.1`, or `::1`, and only after you turn that mode on.
- DexParse never downloads a model and never sends a script to a cloud API.

Open the app, paste a script into **Script (original — authoritative)**, and press **Parse**.

## Live app

**https://westkitty.github.io/Dex_Parse/** — open it in Chrome, Edge or Safari and install it. It is the same offline PWA, built by `.github/workflows/pages.yml` on every push to `main` (`npm run build:pages`, which sets the base path `/Dex_Parse/` and prerenders the page). Nothing you paste leaves the browser.

## Install it as an app (PWA)

DexParse is an installable progressive web app that works offline, either from the live URL above or locally:

```sh
npm ci
npm run app          # builds, then serves http://127.0.0.1:8081
```

Open `http://127.0.0.1:8081` in Chrome or Edge and press **Install** in the DexParse header (or the install icon in the address bar). On iPhone or iPad, use Safari's Share > Add to Home Screen on an HTTPS deployment. After the first visit the whole app, including the parser worker, is cached, so it opens and parses with no network, and with the local server stopped.

**Updates:** when a newer build is served, DexParse downloads it in the background and shows **A new version of DexParse is ready**. Press **Reload to update**. Your script is kept. DexParse checks for updates when the window regains focus and once an hour. `npm run dev` never registers the service worker, so development is not cached.

## Send scripts to DexDiffusion

DexDiffusion's **Audio > Script** (Drama) feature has its own parser. DexParse runs an exact port of it in the **DexDiffusion** tab, shows the scenes, cast, cues and pauses DexDiffusion will create, and lists every line the two grammars read differently. **Export for DexDiffusion** writes the exact request DexDiffusion accepts. `node bin/dexparse-dexdiffusion.mjs send <file>` posts it to DexDiffusion on `127.0.0.1:31337`. The details are in [docs/DEXDIFFUSION.md](docs/DEXDIFFUSION.md).

## What you can do

- Import a UTF-8 `.txt` or `.md` file, a DexParse export, or a DexDiffusion drama project or request (`.json`), or paste text.
- Read the validation line. Green means every character of that parse is classified. The number is the real character count.
- Inspect blocks, playback order, and diagnostics.
- Copy JSON or playback text.
- Export `dexparse-rN.json`. Exporting the same name again asks you to confirm.
- Load the labeled sample, or the generated 6,667-character test fixture. Neither one is your script.

Keyboard: Ctrl+Enter or Command+Enter parses. The divider between the script and the results can be dragged.

## Parser

Speaker detection, scene headings, cues, and the prose-colon guard are documented in [docs/GRAMMAR.md](docs/GRAMMAR.md). The export shape is [docs/SCHEMA.md](docs/SCHEMA.md) and [docs/dexparse.schema.json](docs/dexparse.schema.json).

Engine layout:

| Piece | Path |
| --- | --- |
| Source revision and hash | `src/lib/dexparse/source.ts` |
| Grammar | `src/lib/dexparse/grammar.ts` |
| Deterministic parser | `src/lib/dexparse/parser.ts` |
| Coverage validator | `src/lib/dexparse/validator.ts` |
| JSON export | `src/lib/dexparse/serialize.ts` |
| Ollama adapter | `src/lib/dexparse/ollama.ts` |
| DexDiffusion Drama parser port | `src/lib/dexparse/dexdiffusion/drama-parse.mjs` |
| DexDiffusion bridge and difference report | `src/lib/dexparse/dexdiffusion/compat.ts`, `bridge.mjs` |
| DexDiffusion CLI | `bin/dexparse-dexdiffusion.mjs` |
| PWA (manifest, icons, service worker) | `public/manifest.webmanifest`, `public/icons/`, `scripts/pwa/`, `src/lib/pwa/use-pwa.ts` |
| Interface | `src/components/dexparse/dex-parse-app.tsx` |
| Tests | `src/lib/dexparse/parser.test.ts` |
| 6,667-character fixture | `src/lib/dexparse/fixtures/coverage-6667.txt` |

The parser does not import the interface. Tests call `parseDocument` directly.

## Optional Ollama

1. Choose **Local model**.
2. Leave the endpoint on `http://127.0.0.1:11434` unless your local Ollama listens on another loopback port.
3. Check connection. DexParse lists models already installed. It will not pull one.
4. Parse. Only unknown or ambiguous spans are sent, and only to that loopback address. Suggestions stay unapplied until you accept them. Accepting a suggestion changes the classification, not the script.

If the page cannot reach Ollama, the deterministic result still stands. A browser may block the request unless Ollama allows this page's origin.

## Checks

From the project directory:

```sh
npm test
npm run typecheck
npm run lint
npm run dev
npm run app &                                   # production build on 127.0.0.1:8081
node scripts/pwa/pwa-browser-check.mjs          # installability, offline reload, update flow (headless Chrome)
```

`npm test` also runs the DexDiffusion golden and round-trip tests, the CLI tests, and the manifest and service-worker tests. It includes the DexParse suite: every supported form, prose colons, Unicode, LF and CRLF, unknown cues, bad pause durations, the 6,667-character fixture, JSON reconstruction, and malformed or unreachable Ollama responses.
