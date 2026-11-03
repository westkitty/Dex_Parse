/**
 * DexParse ⇄ DexDiffusion Drama bridge.
 *
 * DexDiffusion's "Audio > Script" (Drama) feature takes raw script text and
 * parses it with its own deterministic grammar (drama-parse.mjs is a faithful
 * port). This module:
 *  - builds the exact request body DexDiffusion accepts on
 *    POST /api/drama/projects and POST /api/drama/parse,
 *  - predicts what DexDiffusion will make of the script (scenes, speakers,
 *    cues, pauses, coverage), and
 *  - lists every line where DexParse's grammar and DexDiffusion's disagree, so
 *    the script can be fixed before it is sent. The script is never rewritten.
 */
import type { Kind, Segment } from "../types.ts";
import {
  DD_DEFAULT_SETTINGS,
  DD_LLM_MAX_CHARS,
  DD_SCHEMA,
  keyOf,
  normalizeNewlines,
  parseScript,
  verifySourceCoverage,
  type DdCoverage,
  type DdLine,
  type DdParsed,
} from "./drama-parse.mjs";

import { dexDiffusionRequest } from "./bridge.mjs";

export { DD_SCHEMA, DD_LLM_MAX_CHARS };
export {
  DEXDIFFUSION_DEFAULT_URL,
  dexDiffusionRequest,
  scriptFromJson,
  type DexDiffusionRequest,
} from "./bridge.mjs";

/** What DexDiffusion does with one source line. */
export type DdLineClass = "dialogue" | "narration" | "heading" | "pause" | "cue" | "direction" | "none";

export interface CompatIssue {
  line: number;
  severity: "warning" | "info";
  code: string;
  dexparse: Kind;
  dexdiffusion: DdLineClass;
  message: string;
  start: number;
  end: number;
}

export interface DexDiffusionView {
  parsed: DdParsed;
  coverage: DdCoverage;
  issues: CompatIssue[];
  stats: {
    scenes: number;
    lines: number;
    dialogue: number;
    narration: number;
    cues: number;
    directions: number;
    pauses: number;
    speakers: number;
  };
  /** True when DexDiffusion can take the script: lines found and its own source-coverage proof passes. */
  ready: boolean;
  /** Differences that change what is heard (warnings). */
  warnings: number;
}

export const DEFAULT_NARRATOR = DD_DEFAULT_SETTINGS.narrator_name;

export function dexDiffusionRequestJson(script: string, options: { title?: string; narrator?: string } = {}): string {
  return JSON.stringify(dexDiffusionRequest(script, options), null, 2) + "\n";
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** 1-based line number → what DexDiffusion does with that line. */
export function dexDiffusionLineClasses(parsed: DdParsed, normalizedText: string): Map<number, { cls: DdLineClass; line?: DdLine }> {
  const starts = lineStarts(normalizedText);
  const byId = new Map<string, DdLine>();
  for (const scene of parsed.scenes) for (const line of scene.lines) byId.set(line.id, line);
  const out = new Map<number, { cls: DdLineClass; line?: DdLine }>();
  for (const span of parsed.spans) {
    const lineNo = lineOf(starts, span.start);
    if (out.has(lineNo) && out.get(lineNo)!.cls !== "direction") continue;
    if (span.class === "heading") out.set(lineNo, { cls: "heading" });
    else if (span.class === "pause") out.set(lineNo, { cls: "pause" });
    else {
      const line = span.line_id ? byId.get(span.line_id) : undefined;
      if (!line) continue;
      const cls: DdLineClass =
        line.kind === "dialogue" ? "dialogue" : line.kind === "narration" ? "narration" : line.cue ? "cue" : "direction";
      if (!out.has(lineNo) || cls !== "direction") out.set(lineNo, { cls, line });
    }
  }
  return out;
}

const EXPECTED: Record<Kind, DdLineClass[]> = {
  dialogue: ["dialogue"],
  narration: ["narration"],
  scene_heading: ["heading"],
  title: ["heading"],
  pause: ["pause"],
  sfx: ["cue"],
  music: ["cue"],
  ambience: ["cue"],
  sequence: ["cue", "direction", "pause"],
  unknown: ["direction"],
  ambiguous: ["direction", "heading"],
  formatting: ["none"],
  blank: ["none"],
};

function explain(seg: Segment, cls: DdLineClass, ddLine?: DdLine): { code: string; severity: "warning" | "info"; message: string } {
  const spoken = cls === "dialogue" || cls === "narration";
  if (seg.kind === "pause" && cls === "direction")
    return {
      code: "dd-pause-unit",
      severity: "warning",
      message: "DexDiffusion reads pauses in seconds only, such as [pause 2s], [pause 0.5s] or [beat]. This line becomes a silent stage direction with no pause.",
    };
  if (seg.kind === "pause" && spoken)
    return { code: "dd-pause-spoken", severity: "warning", message: `DexDiffusion would speak this pause as ${cls}. Use [pause 2s].` };
  if ((seg.kind === "sfx" || seg.kind === "music" || seg.kind === "ambience") && (cls === "direction" || spoken))
    return {
      code: "dd-cue-tag",
      severity: "warning",
      message: `DexDiffusion does not recognize this cue tag, so the cue is ${spoken ? "read aloud" : "lost"}. Use [SFX: …], [MUSIC: …] or [AMBIENCE: …].`,
    };
  if (seg.kind === "title" && cls === "narration")
    return {
      code: "dd-title-spoken",
      severity: "warning",
      message: "DexDiffusion has no TITLE: line and would read this aloud as narration. Use a heading such as # Title instead.",
    };
  if (seg.kind === "dialogue" && cls === "narration")
    return {
      code: "dd-speaker-missed",
      severity: "warning",
      message: `DexDiffusion does not treat ${seg.speaker ?? "this name"} as a speaker, so the narrator reads the line, name included. Write the name in ALL CAPS, for example ${keyOf(seg.speaker ?? "NAME")}:.`,
    };
  if (seg.kind === "narration" && cls === "dialogue")
    return {
      code: "dd-extra-speaker",
      severity: "warning",
      message: `DexDiffusion reads this as dialogue for ${ddLine?.speaker ?? "a speaker"}, not narration.`,
    };
  if (seg.kind === "formatting" && spoken)
    return { code: "dd-rule-spoken", severity: "info", message: "DexDiffusion keeps this rule as narration text. Remove it if nothing should be read." };
  if ((seg.kind === "unknown" || seg.kind === "ambiguous" || seg.kind === "sequence") && spoken)
    return { code: "dd-bracket-spoken", severity: "warning", message: `DexDiffusion would read this line aloud as ${cls}.` };
  if (spoken)
    return { code: "dd-spoken", severity: "warning", message: `DexDiffusion would read this line aloud as ${cls}; DexParse classifies it as ${seg.kind}.` };
  return { code: "dd-class", severity: "info", message: `DexDiffusion treats this line as ${cls}; DexParse classifies it as ${seg.kind}.` };
}

/** Lines where DexParse and DexDiffusion disagree. Offsets are DexParse (original-text) offsets. */
export function compareWithDexDiffusion(text: string, segments: Segment[], parsed: DdParsed): CompatIssue[] {
  const normalized = normalizeNewlines(text);
  const starts = lineStarts(normalized);
  const classes = dexDiffusionLineClasses(parsed, normalized);
  // Screenplay-style blocks: a speaker name alone on its line (DexDiffusion "syntax" span with no colon).
  const fountain = new Set(
    parsed.spans
      .filter((sp) => sp.class === "syntax" && sp.line_id && !normalized.slice(sp.start, sp.end).includes(":"))
      .map((sp) => sp.line_id as string),
  );
  const firstLineOf = new Map<string, number>();
  for (const sp of parsed.spans) if (sp.line_id && !firstLineOf.has(sp.line_id)) firstLineOf.set(sp.line_id, lineOf(starts, sp.start));
  const issues: CompatIssue[] = [];
  for (const seg of segments) {
    if (seg.kind === "blank") continue;
    const dd = classes.get(seg.line) ?? { cls: "none" as DdLineClass };
    const base = { line: seg.line, dexparse: seg.kind, dexdiffusion: dd.cls, start: seg.start, end: seg.end };
    if (!EXPECTED[seg.kind].includes(dd.cls)) {
      if (seg.kind === "formatting" && dd.cls === "heading") continue;
      if (dd.line && fountain.has(dd.line.id) && dd.cls === "dialogue") {
        issues.push({
          ...base,
          severity: "info",
          code: "dd-screenplay-cue",
          message: `DexDiffusion reads this screenplay-style block (name on its own line) as dialogue for ${dd.line.speaker}.`,
        });
        continue;
      }
      const joinedFrom = dd.line ? firstLineOf.get(dd.line.id) : undefined;
      if (dd.line && joinedFrom != null && joinedFrom < seg.line && (dd.cls === "dialogue" || dd.cls === "narration")) {
        issues.push({
          ...base,
          severity: "warning",
          code: "dd-joined",
          message: `DexDiffusion joins this line onto the ${dd.cls === "dialogue" ? `${dd.line.speaker} line` : "narration"} that starts on line ${joinedFrom}, because no blank line separates them. Add a blank line before it.`,
        });
        continue;
      }
      issues.push({ ...base, ...explain(seg, dd.cls, dd.line) });
      continue;
    }
    if (seg.kind === "dialogue" && dd.line && seg.speaker && keyOf(seg.speaker) !== dd.line.speaker_key) {
      issues.push({
        ...base,
        code: "dd-speaker-differs",
        severity: "warning",
        message: `DexParse reads the speaker as ${seg.speaker}; DexDiffusion reads ${dd.line.speaker}.`,
      });
      continue;
    }
    const inline = (seg.children ?? []).filter((c) => c.kind === "pause" || c.kind === "sfx" || c.kind === "music" || c.kind === "ambience");
    if ((seg.kind === "dialogue" || seg.kind === "narration") && inline.length) {
      issues.push({
        ...base,
        code: "dd-inline-cue",
        severity: "info",
        message: `DexDiffusion keeps ${inline.map((c) => c.raw.trim()).join(", ")} inside the spoken text instead of timing it. Put the cue on its own line for a real pause or sound.`,
      });
    }
  }
  return issues;
}

export function buildDexDiffusionView(text: string, segments: Segment[], options: { narrator?: string } = {}): DexDiffusionView {
  const parsed = parseScript(text, { narrator: options.narrator });
  const coverage = verifySourceCoverage(text, parsed);
  const issues = compareWithDexDiffusion(text, segments, parsed);
  if (coverage.mismatches.length || coverage.unclassified.length) {
    const starts = lineStarts(normalizeNewlines(text));
    const byId = new Map(parsed.scenes.flatMap((s) => s.lines).map((l) => [l.id, l]));
    const at = (offset: number) => {
      const line = lineOf(starts, offset);
      const seg = segments.find((s) => s.line === line);
      return { line, start: seg?.start ?? 0, end: seg?.end ?? 0, dexparse: seg?.kind ?? ("unknown" as Kind) };
    };
    for (const m of coverage.mismatches) {
      const ddLine = byId.get(m.line_id);
      if (!ddLine) continue;
      issues.push({
        ...at(ddLine.src.start),
        severity: "warning",
        code: "dd-source-check",
        dexdiffusion: ddLine.kind === "direction" ? (ddLine.cue ? "cue" : "direction") : ddLine.kind,
        message: `DexDiffusion's own source check fails on ${m.line_id}: its stored text no longer matches the script slice, so the project is stamped "coverage not ok". Split the line so each cue or pause sits on its own line.`,
      });
    }
    for (const u of coverage.unclassified)
      issues.push({ ...at(u.start), severity: "warning", code: "dd-unclassified", dexdiffusion: "none", message: "DexDiffusion leaves these characters unclassified." });
    issues.sort((a, b) => a.line - b.line);
  }
  const lines = parsed.scenes.flatMap((s) => s.lines);
  const pauses = parsed.spans.filter((s) => s.class === "pause").length;
  const stats = {
    scenes: parsed.scenes.length,
    lines: lines.length,
    dialogue: lines.filter((l) => l.kind === "dialogue").length,
    narration: lines.filter((l) => l.kind === "narration").length,
    cues: lines.filter((l) => l.cue).length,
    directions: lines.filter((l) => l.kind === "direction" && !l.cue).length,
    pauses,
    speakers: parsed.speakers.length,
  };
  const ready = coverage.ok && lines.length > 0;
  return { parsed, coverage, issues, stats, ready, warnings: issues.filter((i) => i.severity === "warning").length };
}
