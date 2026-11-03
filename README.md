# DexParse

Offline script parser. Paste a script, classify it with explicit grammar, check that every character is accounted for, and export JSON. The original text is authoritative and is never rewritten.

## This release

A native SwiftUI app was the preferred build. This environment is Debian without Xcode or a Swift toolchain (`swift` is not installed), so the working release is a local-first desktop-style app:

- The deterministic parser is plain TypeScript.
- Parsing does not use a network call, an account, or a model.
- Optional Ollama help talks only to `localhost`, `127.0.0.1`, or `::1`, and only after you turn that mode on.
- DexParse never downloads a model and never sends a script to a cloud API.

Open the app, paste a script into **Script (original — authoritative)**, and press **Parse**.

## What you can do

- Import a UTF-8 `.txt` or `.md` file, or paste text.
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
npm run dev
```

`npm test` includes the DexParse suite: every supported form, prose colons, Unicode, LF and CRLF, unknown cues, bad pause durations, the 6,667-character fixture, JSON reconstruction, and malformed or unreachable Ollama responses.
