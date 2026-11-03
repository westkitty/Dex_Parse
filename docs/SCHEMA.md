# DexParse JSON schema

Schema id: `dexparse.document/v1`  
Schema version: `1.0.0`  
Machine-readable copy: [dexparse.schema.json](./dexparse.schema.json)

An export contains:

- `schema` and `schemaVersion`
- `generator` — `dexparse-deterministic`, or `dexparse-deterministic+ollama-accepted` after you accept a suggestion
- `source.text` — the authoritative script, unchanged
- `source.revision` — increments when the text you parse actually changes
- `source.sha256` — SHA-256 of the UTF-8 text
- `source.charCount` and `source.newline` (`lf`, `crlf`, `cr`, `mixed`, or `none`)
- `segments` — ordered top-level spans whose raw slices concatenate back to `source.text`
- `diagnostics` — info, warnings, and errors
- `validation` — character counts, gaps, overlaps, and `verified`, `partial`, or `invalid`
- `playback` — a readable projection. It is not a second copy of the source and is not used to reconstruct it.

Each segment has `id`, `kind`, `raw`, `start`, `end`, `line`, `column`, and `origin`. Dialogue may include `speaker` and `delivery`. Cues may include `cueType`, `detail`, and `durationMs`. Scene headings may include `location` and `timeOfDay`. Child cues live in `children` and sit inside the parent range.

`verified` requires full coverage, a reconstructed source equal to the input, and zero unknown or ambiguous characters. Warnings do not by themselves remove the green state.
