# DexParse and DexDiffusion

DexDiffusion (westkitty/Image_Gen, `bin/dexdiffusion`) has a script function: **Audio > Script**, called Drama in the code. You paste a script there, DexDiffusion parses it into scenes, lines, speakers, cues and pauses, and then you cast voices and render. DexParse now speaks that format exactly.

## What "compatible" means here

| DexDiffusion side | DexParse side |
| --- | --- |
| `operator-console/drama.js` `parseScript` and `verifySourceCoverage` (the deterministic Drama parser) | `src/lib/dexparse/dexdiffusion/drama-parse.mjs`, a line-for-line port. Same scenes, line ids, speakers, cue parameters, pauses, spans and coverage proof. |
| `POST /api/drama/parse` `{ script, mode }` → `{ ok, parsed, mode }` | `dexparse-dexdiffusion parse` prints the same JSON, computed locally. |
| `POST /api/drama/projects` `{ title, script, mode, settings }` | **Export for DexDiffusion** in the app, or `dexparse-dexdiffusion request`, writes exactly this body (`dexdiffusion-drama-rN.json`). `dexparse-dexdiffusion send` posts it. |
| Drama project JSON (`dexdiffusion.drama_project.v2`, `source_script`, `source.sha256`) | DexParse imports it (Import, or any CLI command) and gets the original script back byte for byte. DexParse's `source.sha256` equals DexDiffusion's `source_sha256` for the same text. |

The port is pinned to Image_Gen commit `df765a1`. `src/lib/dexparse/dexdiffusion/fixtures/golden.json` holds the real parser's output for 13 scripts (CRLF, lone CR, Unicode, screenplay cues, cue parameters, custom narrator, empty input). `npm test` checks the port against it. When an `Image_Gen` checkout sits next to `Dex_Parse` (or `DEXDIFFUSION_ROOT` points at one), `npm test` also runs 3,000 generated scripts through both parsers and compares them.

## In the app

Parse a script, then open the **DexDiffusion** tab:

- **Ready for DexDiffusion** means DexDiffusion finds lines and its own source-coverage check passes.
- The scene, line, cue and pause counts and the cast are what DexDiffusion will create.
- **Differences from DexParse** lists each line the two grammars read differently, with the fix. Click one to select it in the script. Warnings change what is heard; info lines are just different bookkeeping.
- **Export for DexDiffusion** downloads the request body. **Copy script** copies the exact text for pasting into Audio > Script. **Copy send command** copies the CLI line.

The browser app does not call DexDiffusion directly. DexDiffusion sends no CORS headers and its request guard only accepts its own origin, so a page on another port cannot post to it. The CLI can.

## Grammar differences you will see

| Script | DexParse | DexDiffusion | Fix for DexDiffusion |
| --- | --- | --- | --- |
| `TITLE: Pilot` | title | narration (read aloud) | `# Pilot` |
| `[pause 500ms]`, `[pause 1 min]` | pause | silent direction, no pause | `[pause 0.5s]`, `[pause 60s]` |
| `(beat)`, `[silence 2s]` | narration / unknown | pause | none needed |
| `[AMB: rain]` | ambience | narration, read aloud | `[AMBIENCE: rain]` |
| `MAYA: Wait [pause 1s] now.` | dialogue with a timed pause | one line; the bracket stays in the text | put the cue on its own line |
| A line straight after dialogue, no blank line | its own block | joined onto that dialogue | add a blank line |
| `TOM` / `(whispering)` / `Go back.` | narration | dialogue for TOM | none needed |
| `SCENE 2`, `ACT IV`, `== Part ==` | narration | scene heading | none needed |
| `Maya:` once, while other speakers are ALL CAPS | dialogue | narration unless `Maya` appears twice | `MAYA:` |
| `[NOTE: fix this]` (an unknown tag with a colon) | unknown | narration, read aloud; DexDiffusion's own source check fails | remove it or use a known cue tag |
| `[cut to black]` (no colon) | unknown | silent direction | none needed |

## Command line

From the DexParse folder (Node 18 or newer, no install needed beyond the repo):

```sh
node bin/dexparse-dexdiffusion.mjs parse    script.txt           # what DexDiffusion will parse, as JSON
node bin/dexparse-dexdiffusion.mjs request  script.txt --title "Pilot" > dexdiffusion-drama.json
node bin/dexparse-dexdiffusion.mjs coverage script.txt           # exit 4 when DexDiffusion's source check would fail
node bin/dexparse-dexdiffusion.mjs status                        # GET /api/version on DexDiffusion
node bin/dexparse-dexdiffusion.mjs verify   script.txt           # parse on the running DexDiffusion, diff with the local port
node bin/dexparse-dexdiffusion.mjs send     dexdiffusion-drama-r3.json
```

`npm run dexdiffusion -- <command> …` does the same.

- Input can be a `.txt`/`.md` script, a DexParse export, a DexDiffusion request, or a saved DexDiffusion drama project.
- `--url` (or `DEXDIFFUSION_URL`) defaults to `http://127.0.0.1:31337`. Only loopback and `https://*.ts.net` tailnet hosts are accepted unless you pass `--allow-any-host`.
- `send` creates an **unsaved** project. Open DexDiffusion > Audio > Script, pick it, bind voices, and press **Save project** to keep it. Nothing is written to disk until you do.
- Exit codes: 0 ok, 1 usage or input error, 2 DexDiffusion not reachable, 3 DexDiffusion refused the request, 4 coverage would fail, 5 `verify` found the live parser differs from the port.

## When DexDiffusion's parser changes

1. Run `node bin/dexparse-dexdiffusion.mjs verify <script>` against the updated DexDiffusion. Exit 5 means the port is stale.
2. Port the change into `drama-parse.mjs` and bump `DD_REFERENCE_COMMIT`.
3. `node scripts/dexdiffusion-golden.mjs ../Image_Gen` to regenerate `golden.json`, then `npm test`.
