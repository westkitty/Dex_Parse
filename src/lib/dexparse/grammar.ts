/**
 * Explicit speaker and cue grammar.
 * See docs/GRAMMAR.md for the human-readable contract. This module is the
 * machine source of those rules.
 */

/** Single-token Title Case labels that are prose, not character names. */
export const PROSE_STARTERS = new Set([
  "remember",
  "however",
  "meanwhile",
  "suddenly",
  "later",
  "after",
  "before",
  "then",
  "because",
  "when",
  "while",
  "please",
  "important",
  "update",
  "status",
  "result",
  "results",
  "conclusion",
  "introduction",
  "overview",
  "background",
  "context",
  "problem",
  "solution",
  "step",
  "steps",
  "item",
  "items",
  "also",
  "see",
  "yes",
  "okay",
  "ok",
  "hello",
  "note",
  "notes",
  "warning",
  "caution",
  "chapter",
  "scene",
  "act",
  "time",
  "date",
  "location",
  "setting",
  "author",
  "synopsis",
  "summary",
  "draft",
  "version",
  "page",
  "todo",
  "fixme",
  "ps",
  "pps",
  "nb",
  "example",
  "examples",
  "dialogue",
  "narration",
  "sfx",
  "music",
  "ambience",
  "ambient",
  "pause",
  "cue",
  "cues",
  "end",
  "start",
  "fade",
  "cut",
  "transition",
  "cast",
  "character",
  "characters",
  "subtitle",
  "logline",
  "copyright",
  "interior",
  "exterior",
  "fadein",
  "fadeout",
  "int",
  "ext",
  "day",
  "night",
  "morning",
  "evening",
  "dawn",
  "dusk",
]);

/**
 * Speaker token:
 * - initials (J. / J.R.)
 * - Title Case Latin (Maya, José, O'Brien, Mary-Jane, Dr.)
 * - ALL CAPS / cased uppercase run of at least 2 (MAYA, JOSÉ, МАЯ)
 * - caseless letters, 1–12 chars (ナオキ, 漢字) so non-Latin names work
 *   without treating a long unspaced sentence as a name
 */
export const SPEAKER_TOKEN =
  "(?:\\p{Lu}\\.(?:\\p{Lu}\\.)*|\\p{Lu}\\p{Ll}+(?:['’\\-][\\p{Lu}]?\\p{Ll}+)*\\.?|\\p{Lu}[\\p{Lu}\\p{N}'’\\.\\-]{1,30}|\\p{Lo}{1,12})";

export const SPEAKER_NAME = `${SPEAKER_TOKEN}(?:[ \\t]+${SPEAKER_TOKEN}){0,2}`;

export const DIALOGUE_RE = new RegExp(
  `^([ \\t]*)(${SPEAKER_NAME})(?:[ \\t]*\\(([^)\\n]{1,80})\\))?[ \\t]*:[ \\t]?([\\s\\S]*)$`,
  "u",
);

export const SCENE_PREFIX_RE = /^(INT\/EXT\.|I\/E\.|INT\.|EXT\.)/i;

export const TIME_OF_DAY =
  "(?:DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|AFTERNOON|MIDNIGHT|NOON|SUNSET|SUNRISE|CONTINUOUS|LATER|SAME|MAGIC HOUR)(?:[ \\t]+(?:LATER|CONTINUOUS))?";

export const SCENE_RE = new RegExp(
  `^(INT\\/EXT\\.|I\\/E\\.|INT\\.|EXT\\.)[ \\t]+(.+?)[ \\t]*[—–-][ \\t]*(${TIME_OF_DAY})[ \\t]*$`,
  "iu",
);

export const ATX_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u;

export const RULE_RE = /^[ \t]*([-*_])\1{2,}[ \t]*$/;

export const EQUALS_RULE_RE = /^[ \t]*=+[ \t]*$/;

export function equalsCount(text: string): number {
  const m = /^[ \t]*(=+)[ \t]*$/.exec(text);
  return m ? m[1].length : 0;
}

const PAUSE_RE =
  /^pause\b[ \t]*:?[ \t]*(.*)$/i;
const DURATION_RE =
  /^(\d+(?:\.\d+)?)[ \t]*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes)$/i;
const SFX_RE = /^sfx[ \t]*:[ \t]*([\s\S]*)$/i;
const MUSIC_RE = /^music[ \t]*:[ \t]*([\s\S]*)$/i;
const AMBIENCE_RE = /^(?:ambience|ambient|amb)[ \t]*:[ \t]*([\s\S]*)$/i;
const DELIVERY_RE = /^[\p{L}\p{N}][\p{L}\p{N} ,.'’-]{0,59}$/u;

export type BracketKind =
  | "pause"
  | "sfx"
  | "music"
  | "ambience"
  | "delivery"
  | "unknown";

export interface BracketInfo {
  kind: BracketKind;
  durationMs?: number;
  detail?: string;
  warning?: "pause_duration_missing" | "pause_duration_invalid";
  warningDetail?: string;
}

export function classifyBracketInner(inner: string): BracketInfo {
  const trimmed = inner.trim();
  const pause = PAUSE_RE.exec(trimmed);
  if (pause) {
    const rest = pause[1].trim();
    if (!rest) return { kind: "pause", warning: "pause_duration_missing" };
    const dur = DURATION_RE.exec(rest);
    if (!dur) {
      return {
        kind: "pause",
        warning: "pause_duration_invalid",
        warningDetail: rest,
      };
    }
    return { kind: "pause", durationMs: durationToMs(dur[1], dur[2]), detail: rest };
  }
  const sfx = SFX_RE.exec(trimmed);
  if (sfx) return { kind: "sfx", detail: sfx[1].trim() };
  const music = MUSIC_RE.exec(trimmed);
  if (music) return { kind: "music", detail: music[1].trim() };
  const amb = AMBIENCE_RE.exec(trimmed);
  if (amb) return { kind: "ambience", detail: amb[1].trim() };
  if (trimmed.length > 0 && trimmed.length <= 60 && !trimmed.includes(":") && DELIVERY_RE.test(trimmed)) {
    return { kind: "delivery", detail: trimmed };
  }
  return { kind: "unknown", detail: trimmed };
}

export function durationToMs(num: string, unit: string): number {
  const n = Number(num);
  const u = unit.toLowerCase();
  if (u === "ms") return Math.round(n);
  if (u === "m" || u.startsWith("min")) return Math.round(n * 60_000);
  return Math.round(n * 1000);
}

export function hasLower(token: string): boolean {
  return /\p{Ll}/u.test(token);
}

export function speakerTokens(name: string): string[] {
  return name.trim().split(/[ \t]+/).filter(Boolean);
}

export interface FoundBracket {
  raw: string;
  inner: string;
  start: number;
  end: number;
  info: BracketInfo;
}

/** Walk a slice for non-nested [brackets]. Offsets are absolute. */
export function findBrackets(text: string, base: number): {
  brackets: FoundBracket[];
  residue: string;
  unclosed: boolean;
} {
  const brackets: FoundBracket[] = [];
  let residue = "";
  let unclosed = false;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "[") {
      const close = text.indexOf("]", i + 1);
      if (close === -1) {
        residue += text.slice(i);
        unclosed = true;
        break;
      }
      const raw = text.slice(i, close + 1);
      const inner = text.slice(i + 1, close);
      brackets.push({
        raw,
        inner,
        start: base + i,
        end: base + close + 1,
        info: classifyBracketInner(inner),
      });
      i = close + 1;
    } else {
      residue += text[i];
      i += 1;
    }
  }
  return { brackets, residue, unclosed };
}

export function onlyBrackets(residue: string, count: number, unclosed: boolean): boolean {
  return count > 0 && !unclosed && residue.trim().length === 0;
}
