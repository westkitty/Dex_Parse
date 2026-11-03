# DexParse grammar

The deterministic parser uses the rules below. It does not infer meaning, and it never rewrites the source. Offsets are UTF-16 code units, the same indexes JavaScript uses, so the original string can be rebuilt by concatenating segment slices.

A green result means every character sits in a recognized classification, the slices tile the source with no gaps or overlaps, and nothing was left ambiguous or unknown. A warning, such as a pause with no duration, can still be green: the characters were classified. Unknown brackets and broken scene headings are preserved and counted as not interpreted.

## Speaker names

A dialogue line matches only when the text before the colon is a speaker and an optional delivery parenthetical.

A speaker is one, two, or three tokens:

- Initials: `J.` or `J.R.`
- Title Case Latin: `Maya`, `José`, `O'Brien`, `Mary-Jane`, `Dr.`
- ALL CAPS, at least two letters: `MAYA`, `JOSÉ`
- Caseless letters, 1–12 characters: `ナオキ`

`NAME: text` and `NAME (whispering): text` are dialogue. `NAME: [quietly] text` stores `quietly` as delivery. The bracket stays in the raw line.

A single Title Case token that is a prose label is narration, not a speaker. The list includes Note, Remember, Warning, Chapter, Time, However, and the other words in `PROSE_STARTERS`. The same word in ALL CAPS is still a speaker: `NOTE:` is dialogue, `Note:` is narration. `TITLE` and `Title` are titles, not speakers.

Lines whose text before a colon contains lowercase words (`The ratio is 3:1 tonight.`) do not match the speaker pattern and stay narration.

## Other lines

| Form | Classification |
| --- | --- |
| `INT. LOCATION — NIGHT`, `EXT. LOCATION - DAY` | Scene heading. Prefix `INT.`, `EXT.`, `INT/EXT.`, or `I/E.`, then a location, a dash (`—`, `–`, or `-`), then a time of day. |
| `INT.` without a time of day | Ambiguous. Preserved, not converted into narration. |
| `TITLE: …`, `# Heading`, or a short line underlined with `===` | Title |
| `[pause 2s]`, `[pause 500ms]`, `[pause 1 min]` | Pause. The unit is required. `[pause]` and `[pause soon]` stay pauses and raise a warning. |
| `[SFX: …]` | Sound effect |
| `[MUSIC: …]` | Music |
| `[AMBIENCE: …]`, `[AMBIENT: …]`, `[AMB: …]` | Ambience |
| Any other `[…]` | Unknown instruction. Preserved. Not folded into another type. |
| Blank or whitespace-only line | Blank |
| `---`, `***`, `___`, or a lone `===` | Formatting |
| Anything else | Narration. Inline cues inside the line become child spans. |

Compound dialogue keeps one parent span for the whole line, including its newline. Inline pauses and sound cues are children. Playback walks the spoken slices and the cues in order. Reconstruction uses the parent slices only, so children are not counted twice.

## What is never done

- Characters are not inserted, deleted, reordered, or paraphrased.
- A colon inside ordinary prose does not create a speaker.
- Brackets the grammar does not know are not guessed into sound or dialogue.
- Text inside the script cannot change the endpoint, export a file, or run a command.
- The optional Ollama adapter may suggest a classification for an unknown or ambiguous span. The suggestion is discarded unless its start and end match that span exactly and it does not replace the raw text. It is applied only after you accept it.

## DexDiffusion

DexDiffusion's Audio > Script (Drama) parser uses a different grammar. The **DexDiffusion** tab shows exactly how it reads the same text and lists the differences. See [DEXDIFFUSION.md](./DEXDIFFUSION.md).
