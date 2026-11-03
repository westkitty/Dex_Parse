/** Types for drama-parse.mjs: the DexDiffusion Drama parser port. Shapes mirror Image_Gen operator-console/drama.js. */

export interface DdCue {
  role: "sfx" | "music" | "ambience";
  description: string;
  params: {
    fade_in_s?: number;
    fade_out_s?: number;
    duration_s?: number;
    loop?: boolean;
    optional?: boolean;
    required?: boolean;
    duck?: boolean;
  };
}

export type DdKind = "dialogue" | "narration" | "direction";
export type DdSpanClass = "dialogue" | "narration" | "heading" | "direction" | "pause" | "syntax";

export interface DdLine {
  id: string;
  speaker: string;
  speaker_key: string;
  kind: DdKind;
  text: string;
  direction: string;
  pause_before_s: number | null;
  pause_after_s: number | null;
  render: boolean;
  src: { start: number; end: number };
  takes: unknown[];
  active_take_id: string | null;
  cue?: DdCue;
}

export interface DdScene {
  id: string;
  title: string;
  lines: DdLine[];
}

export interface DdSpeaker {
  key: string;
  name: string;
  lines: number;
  kinds: { dialogue: number; narration: number };
}

export interface DdSpan {
  start: number;
  end: number;
  class: DdSpanClass;
  line_id: string | null;
}

export interface DdParsed {
  source_length: number;
  title: string | null;
  scenes: DdScene[];
  speakers: DdSpeaker[];
  warnings: string[];
  spans: DdSpan[];
}

export interface DdCoverage {
  ok: boolean;
  unclassified: Array<{ start: number; end: number }>;
  mismatches: Array<{ line_id: string; scene_id: string; reason: string }>;
  problems: Array<{ index: number; reason: string }>;
  counts: Record<DdSpanClass, number>;
  classified_chars: number;
  total_chars: number;
}

export const DD_SCHEMA: "dexdiffusion.drama_project.v2";
export const DD_REFERENCE_COMMIT: string;
export const DD_KINDS: DdKind[];
export const DD_DEFAULT_SETTINGS: Readonly<{
  line_gap_s: number;
  scene_gap_s: number;
  narrator_name: string;
  default_language: string;
}>;
export const DD_SPAN_CLASSES: DdSpanClass[];
export const DD_LLM_MAX_CHARS: number;
export function parseCue(text: string): DdCue | null;
export function keyOf(s: string): string;
export function normalizeNewlines(s: string): string;
export function normalizeSpoken(s: string): string;
export function parseScript(source: string, opts?: { narrator?: string }): DdParsed;
export function reconstructLineText(text: string, line: Pick<DdLine, "src" | "kind">): string;
export function verifySourceCoverage(source: string, parsed: Pick<DdParsed, "spans" | "scenes">): DdCoverage;
