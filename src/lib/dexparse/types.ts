/** DexParse document schema. Offsets are UTF-16 code units (JavaScript string indices). */

export const SCHEMA_ID = "dexparse.document/v1" as const;
export const SCHEMA_VERSION = "1.0.0" as const;

export const KINDS = [
  "dialogue",
  "scene_heading",
  "title",
  "pause",
  "sfx",
  "music",
  "ambience",
  "narration",
  "blank",
  "formatting",
  "sequence",
  "unknown",
  "ambiguous",
] as const;

export type Kind = (typeof KINDS)[number];

/** Kinds a local model may suggest. Sequence, unknown, and ambiguous are never applied from a model. */
export const SUGGESTABLE_KINDS = [
  "dialogue",
  "scene_heading",
  "title",
  "pause",
  "sfx",
  "music",
  "ambience",
  "narration",
  "blank",
  "formatting",
] as const;

export type SuggestableKind = (typeof SUGGESTABLE_KINDS)[number];

export type Severity = "info" | "warning" | "error";

export type Origin = "deterministic" | "ollama-accepted";

export type CueType = "pause" | "sfx" | "music" | "ambience";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  segmentId?: string;
  start?: number;
  end?: number;
}

export interface Segment {
  id: string;
  kind: Kind;
  /** Exact source slice covering [start, end). Never rewritten. */
  raw: string;
  start: number;
  end: number;
  line: number;
  column: number;
  speaker?: string;
  delivery?: string;
  cueType?: CueType;
  /** Cue body, title text, or scene location detail. Metadata only — not a rewrite. */
  detail?: string;
  durationMs?: number;
  location?: string;
  timeOfDay?: string;
  headingLevel?: number;
  /** Absolute index where spoken or narration payload begins, when relevant. */
  contentStart?: number;
  warnings: Diagnostic[];
  ambiguous?: boolean;
  origin: Origin;
  children?: Segment[];
}

export interface Gap {
  start: number;
  end: number;
}

export interface Validation {
  sourceChars: number;
  accountedChars: number;
  classifiedChars: number;
  unclassifiedChars: number;
  coverageComplete: boolean;
  reconstructedMatches: boolean;
  gaps: Gap[];
  overlaps: Gap[];
  ambiguityCount: number;
  unknownCount: number;
  warningCount: number;
  errorCount: number;
  /** verified: every character semantically classified and coverage holds. */
  status: "verified" | "partial" | "invalid";
}

export interface ParseOutput {
  segments: Segment[];
  diagnostics: Diagnostic[];
  validation: Validation;
}

export type NewlineStyle = "lf" | "crlf" | "cr" | "mixed" | "none";

export interface SourceRevision {
  revision: number;
  text: string;
  sha256: string;
  charCount: number;
  newline: NewlineStyle;
  encoding: "utf-8";
}

export interface PlaybackEvent {
  id: string;
  order: number;
  kind: Kind;
  /** Exact source slice for this event (spoken fragment or cue). */
  text: string;
  speaker?: string;
  delivery?: string;
  durationMs?: number;
  line: number;
  column: number;
  segmentId: string;
}

export interface DexDocument {
  schema: typeof SCHEMA_ID;
  schemaVersion: typeof SCHEMA_VERSION;
  generator: "dexparse-deterministic" | "dexparse-deterministic+ollama-accepted";
  source: SourceRevision;
  segments: Segment[];
  diagnostics: Diagnostic[];
  validation: Validation;
  playback: PlaybackEvent[];
}

export function isRecognizedKind(kind: Kind): boolean {
  return kind !== "unknown" && kind !== "ambiguous";
}
